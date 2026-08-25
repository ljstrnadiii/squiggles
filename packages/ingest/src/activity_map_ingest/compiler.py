from __future__ import annotations

import csv
import hashlib
import json
import math
import shutil
import tempfile
import time
import zipfile
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Protocol, cast

import duckdb
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
import ray
from pandera.typing.pyarrow import Table

from .geoparquet_sink import GeoParquetDataSink, RenderPyramidDataSink
from .parsers import TrackPoint, checksum, clean_track, haversine_distance, parse_track, simplify
from .schema import (
    SCHEMA_VERSION,
    ActivitySchema,
    ProcessingSchema,
    RejectionSchema,
    activity_arrow_schema,
    validate_arrow_table,
)

COMPILER_VERSION = "0.4.0"
SUPPORTED = (".fit", ".fit.gz", ".gpx", ".gpx.gz", ".tcx", ".tcx.gz")


@dataclass(frozen=True, slots=True)
class CompileOptions:
    input_path: Path
    output_path: Path
    overwrite: bool = False
    batch_size: int = 16
    num_cpus: int | None = None
    max_rejections: int | None = None
    max_rejection_rate: float | None = None
    target_shard_rows: int = 512
    row_group_rows: int = 128
    progress_callback: Callable[[int, int], None] | None = None


class ActivitySourceAdapter(Protocol):
    """Boundary between source-specific discovery and canonical compilation."""

    def prepare(self, input_path: Path, temporary_directory: Path) -> Path: ...

    def records(self, root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]: ...


class StravaSourceAdapter:
    def prepare(self, input_path: Path, temporary_directory: Path) -> Path:
        if input_path.is_file():
            return _safe_extract(input_path, temporary_directory)
        return input_path

    def records(self, root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return _records(root)


def _safe_extract(archive: Path, destination: Path) -> Path:
    total = 0
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        for member in members:
            pure = PurePosixPath(member.filename)
            if pure.is_absolute() or ".." in pure.parts or member.is_dir():
                if pure.is_absolute() or ".." in pure.parts:
                    raise ValueError(f"unsafe archive member: {member.filename}")
                continue
            if member.filename != "activities.csv" and not member.filename.startswith(
                "activities/"
            ):
                continue
            total += member.file_size
            if member.file_size > 1_000_000_000 or total > 20_000_000_000:
                raise ValueError("archive exceeds safe decompression limits")
            target = destination.joinpath(*pure.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(member) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
    return destination


def _header_positions(header: list[str]) -> dict[str, list[int]]:
    result: dict[str, list[int]] = {}
    for index, name in enumerate(header):
        result.setdefault(name, []).append(index)
    return result


def _cell(row: list[str], positions: dict[str, list[int]], name: str, occurrence: int = 0) -> str:
    indexes = positions.get(name, [])
    return (
        row[indexes[occurrence]].strip()
        if len(indexes) > occurrence and len(row) > indexes[occurrence]
        else ""
    )


def _number(value: str) -> float | None:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except ValueError:
        return None


def _timestamp(value: str) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    for parser in (
        datetime.fromisoformat,
        lambda item: datetime.strptime(item, "%b %d, %Y, %I:%M:%S %p"),
    ):
        try:
            parsed = parser(normalized)
            return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
        except ValueError:
            continue
    return None


def _records(root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    csv_path, activity_dir = root / "activities.csv", root / "activities"
    if not csv_path.is_file() or not activity_dir.is_dir():
        raise ValueError("input must contain activities.csv and activities/")
    files = {p.relative_to(root).as_posix(): p for p in activity_dir.iterdir() if p.is_file()}
    files.update({p.name: p for p in activity_dir.iterdir() if p.is_file()})
    records: list[dict[str, Any]] = []
    rejects: list[dict[str, Any]] = []
    matched: set[Path] = set()
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        positions = _header_positions(next(reader))
        for row in reader:
            source_id = _cell(row, positions, "Activity ID") or None
            filename = _cell(row, positions, "Filename")
            path = files.get(filename) or files.get(PurePosixPath(filename).name)
            if path is None:
                rejects.append(
                    _reject(
                        filename,
                        source_id,
                        "discovery",
                        "missing_file",
                        "metadata row has no matching activity file",
                    )
                )
                continue
            matched.add(path)
            lower = path.name.lower()
            if not any(lower.endswith(ext) for ext in SUPPORTED):
                rejects.append(
                    _reject(
                        filename,
                        source_id,
                        "discovery",
                        "unsupported_format",
                        "activity file format is unsupported",
                    )
                )
                continue
            records.append(
                {
                    "path": str(path),
                    "source_filename": filename or path.name,
                    "source_activity_id": source_id,
                    "name": _cell(row, positions, "Activity Name") or "Untitled activity",
                    "sport_type": _cell(row, positions, "Activity Type")
                    or _cell(row, positions, "Type")
                    or "Activity",
                    "start_text": _cell(row, positions, "Activity Date")
                    or _cell(row, positions, "Start Time"),
                    "distance_csv": (
                        _number(
                            _cell(row, positions, "Distance", 1)
                            or _cell(row, positions, "Distance")
                        )
                        or 0
                    )
                    * 1000,
                    "elapsed_csv": _number(
                        _cell(row, positions, "Elapsed Time", 1)
                        or _cell(row, positions, "Elapsed Time")
                    ),
                    "moving_csv": _number(_cell(row, positions, "Moving Time")),
                    "gain_csv": _number(_cell(row, positions, "Elevation Gain")),
                    "loss_csv": _number(_cell(row, positions, "Elevation Loss")),
                    "min_elevation_csv": _number(_cell(row, positions, "Elevation Low")),
                    "max_elevation_csv": _number(_cell(row, positions, "Elevation High")),
                }
            )
    for path in activity_dir.iterdir():
        if path.is_file() and path not in matched:
            rejects.append(
                _reject(
                    path.name,
                    None,
                    "discovery",
                    "unmatched_file",
                    "activity file has no metadata row",
                )
            )
    return records, rejects


def _reject(
    path: str, activity_id: str | None, stage: str, code: str, message: str
) -> dict[str, Any]:
    return {
        "source_path": PurePosixPath(path).name,
        "source_activity_id": activity_id,
        "stage": stage,
        "reason_code": code,
        "message": message[:300],
    }


def _spatial_key(lon: float, lat: float) -> int:
    x = max(0, min(65535, int((lon + 180) / 360 * 65535)))
    y = max(0, min(65535, int((lat + 90) / 180 * 65535)))

    def spread(value: int) -> int:
        value = (value | (value << 8)) & 0x00FF00FF
        value = (value | (value << 4)) & 0x0F0F0F0F
        value = (value | (value << 2)) & 0x33333333
        return (value | (value << 1)) & 0x55555555

    return spread(x) | (spread(y) << 1)


def _activity_family(sport_type: str) -> str:
    normalized = sport_type.casefold()
    families = {
        "run": ("run",),
        "ride": ("ride", "cycling", "bike"),
        "ski": ("ski", "snowboard"),
        "foot": ("walk", "hike"),
        "water": ("kayak", "row", "swim", "surf", "water", "paddl", "canoe"),
    }
    return next(
        (family for family, terms in families.items() if any(term in normalized for term in terms)),
        "other",
    )


class _ProgressCounter:
    def __init__(self) -> None:
        self.completed = 0

    def advance(self, count: int) -> None:
        self.completed += count

    def value(self) -> int:
        return self.completed


def _process_batch(batch: pa.Table, progress: Any = None) -> Table[ProcessingSchema]:
    output: list[dict[str, Any]] = []
    for source in batch.to_pylist():
        try:
            points = parse_track(source["path"])
            if len(points) < 2:
                raise ValueError("activity has fewer than two valid route points")
            output.append(_activity(source, points))
        except Exception as error:
            output.append(
                {
                    "_rejection": json.dumps(
                        _reject(
                            source["source_filename"],
                            source["source_activity_id"],
                            "parse",
                            type(error).__name__,
                            str(error),
                        )
                    )
                }
            )
    if progress is not None:
        progress.advance.remote(batch.num_rows)
    return cast(Table[ProcessingSchema], pa.Table.from_pylist(output, schema=_processing_schema()))


def _accepted_batch(batch: pa.Table) -> Table[ActivitySchema]:
    accepted = batch.filter(pc.is_null(batch["_rejection"])).drop_columns(["_rejection"])
    return cast(Table[ActivitySchema], accepted)


def _rejected_batch(batch: pa.Table) -> Table[RejectionSchema]:
    messages = batch.filter(pc.is_valid(batch["_rejection"]))["_rejection"].to_pylist()
    schema = pa.schema(
        [
            pa.field("source_path", pa.string(), False),
            pa.field("source_activity_id", pa.string()),
            pa.field("stage", pa.string(), False),
            pa.field("reason_code", pa.string(), False),
            pa.field("message", pa.string(), False),
        ]
    )
    return cast(
        Table[RejectionSchema],
        pa.Table.from_pylist([json.loads(value) for value in messages], schema=schema),
    )


def _partition_batch(batch: pa.Table) -> Table[ProcessingSchema]:
    """Preserve one complete Hive group per Ray block before sink-side shard chunking."""
    return cast(Table[ProcessingSchema], batch)


def _processing_schema() -> pa.Schema:
    fields = [field.with_nullable(True) for field in activity_arrow_schema()]
    return pa.schema(
        [
            *fields,
            pa.field("activity_family", pa.string()),
            pa.field("_rejection", pa.string()),
        ]
    )


def _activity(source: dict[str, Any], points: list[TrackPoint]) -> dict[str, Any]:
    cleaned = clean_track(points)
    clean_points = cleaned.points
    times = [p.timestamp for p in points if p.timestamp]
    elevations = [float(p.elevation_m) for p in points if p.elevation_m is not None]
    clean_elevations = [float(p.elevation_m) for p in clean_points if p.elevation_m is not None]
    start = min(times) if times else _timestamp(source["start_text"])
    end = max(times) if times else None
    elapsed_track = (end - start).total_seconds() if start and end else None
    distance_track = haversine_distance(points)
    clean_distance = haversine_distance(clean_points)
    gain = (
        sum(max(0.0, b - a) for a, b in zip(elevations, elevations[1:], strict=False))
        if len(elevations) > 1
        else None
    )
    loss = (
        sum(max(0.0, a - b) for a, b in zip(elevations, elevations[1:], strict=False))
        if len(elevations) > 1
        else None
    )
    clean_gain = (
        sum(max(0.0, b - a) for a, b in zip(clean_elevations, clean_elevations[1:], strict=False))
        if len(clean_elevations) > 1
        else None
    )
    clean_loss = (
        sum(max(0.0, a - b) for a, b in zip(clean_elevations, clean_elevations[1:], strict=False))
        if len(clean_elevations) > 1
        else None
    )
    lons, lats = [p.longitude for p in points], [p.latitude for p in points]
    clean_lons = [p.longitude for p in clean_points]
    clean_lats = [p.latitude for p in clean_points]
    if start is None:
        start = datetime(1970, 1, 1, tzinfo=UTC)
    source_id = source["source_activity_id"]
    digest = checksum(source["path"])
    activity_id = (
        source_id or hashlib.sha256(f"strava:{source['start_text']}:{digest}".encode()).hexdigest()
    )
    full = [[p.longitude, p.latitude] for p in points]
    clean_full = [[p.longitude, p.latitude] for p in clean_points]
    clean_point_ids = {id(point) for point in clean_points}
    return {
        "activity_id": activity_id,
        "source_activity_id": source_id,
        "source_filename": source["source_filename"],
        "source_type": Path(source["path"].removesuffix(".gz")).suffix[1:].lower(),
        "source_checksum": digest,
        "schema_version": SCHEMA_VERSION,
        "compiler_version": COMPILER_VERSION,
        "name": source["name"],
        "sport_type": source["sport_type"],
        "start_time": start,
        "end_time": end,
        "original_start_time": source["start_text"] or None,
        "source_url": f"https://www.strava.com/activities/{source_id}" if source_id else None,
        "distance_m": distance_track if distance_track > 0 else source["distance_csv"],
        "elapsed_seconds": elapsed_track if elapsed_track is not None else source["elapsed_csv"],
        "moving_seconds": source["moving_csv"] or elapsed_track,
        "elevation_gain_m": gain if gain is not None else source["gain_csv"],
        "elevation_loss_m": loss if loss is not None else source["loss_csv"],
        "min_elevation_m": min(elevations) if elevations else source["min_elevation_csv"],
        "max_elevation_m": max(elevations) if elevations else source["max_elevation_csv"],
        "point_count": len(points),
        "clean_point_count": len(clean_points),
        "dropped_jump_points": cleaned.dropped_jump_points,
        "dropped_elevation_points": cleaned.dropped_elevation_points,
        "clean_distance_m": clean_distance,
        "clean_elevation_gain_m": clean_gain,
        "clean_elevation_loss_m": clean_loss,
        "clean_min_elevation_m": min(clean_elevations) if clean_elevations else None,
        "clean_max_elevation_m": max(clean_elevations) if clean_elevations else None,
        "xmin": min(lons),
        "ymin": min(lats),
        "xmax": max(lons),
        "ymax": max(lats),
        "clean_xmin": min(clean_lons),
        "clean_ymin": min(clean_lats),
        "clean_xmax": max(clean_lons),
        "clean_ymax": max(clean_lats),
        "start_year": start.year,
        "start_month": start.month,
        "activity_family": _activity_family(source["sport_type"]),
        "spatial_order": _spatial_key((min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2),
        "distance_source": "track" if distance_track > 0 else "csv",
        "moving_time_source": "csv" if source["moving_csv"] is not None else "track",
        "elevation_source": "track" if elevations else "csv",
        "geometry": full,
        "geometry_lod0": simplify(points, 40),
        "geometry_lod1": simplify(points, 100),
        "geometry_lod2": simplify(points, 400),
        "geometry_lod3": simplify(points, 2000),
        "geometry_clean": clean_full,
        "geometry_clean_lod0": simplify(clean_points, 40),
        "geometry_clean_lod1": simplify(clean_points, 100),
        "geometry_clean_lod2": simplify(clean_points, 400),
        "geometry_clean_lod3": simplify(clean_points, 2000),
        "track_points": [
            {
                "sequence": i,
                "timestamp": p.timestamp,
                "longitude": p.longitude,
                "latitude": p.latitude,
                "elevation_m": p.elevation_m,
                "heart_rate": p.heart_rate,
                "cadence": p.cadence,
                "power": p.power,
                "clean": id(p) in clean_point_ids,
            }
            for i, p in enumerate(points)
        ],
    }


def _finalize_dataset(
    rejects: list[dict[str, Any]],
    output: Path,
    shards: list[dict[str, Any]],
    render_levels: list[dict[str, Any]],
) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    bounds = [180.0, 90.0, -180.0, -90.0]
    first: str | None = None
    last: str | None = None
    source_counts: dict[str, int] = {}
    activity_count = sum(int(shard["row_count"]) for shard in shards)
    for shard in shards:
        shard_bounds = shard["bbox"]
        bounds = [
            min(bounds[0], shard_bounds[0]),
            min(bounds[1], shard_bounds[1]),
            max(bounds[2], shard_bounds[2]),
            max(bounds[3], shard_bounds[3]),
        ]
        shard_first = shard["first_activity"]
        shard_last = shard["last_activity"]
        first = shard_first if first is None else min(first, shard_first)
        last = shard_last if last is None else max(last, shard_last)
        for source_type, count in shard["source_counts"].items():
            source_counts[source_type] = source_counts.get(source_type, 0) + count
    rejection_schema = pa.schema(
        [
            pa.field("source_path", pa.string()),
            pa.field("source_activity_id", pa.string()),
            pa.field("stage", pa.string()),
            pa.field("reason_code", pa.string()),
            pa.field("message", pa.string()),
        ]
    )
    pq.write_table(
        pa.Table.from_pylist(rejects, schema=rejection_schema),
        output / "rejections.parquet",
        compression="zstd",
    )
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "compiler_version": COMPILER_VERSION,
        "relation": "activities",
        "activity_count": activity_count,
        "rejection_count": len(rejects),
        "bbox": bounds,
        "first_activity": first,
        "last_activity": last,
        "shards": [
            {
                key: value
                for key, value in shard.items()
                if key not in {"first_activity", "last_activity", "source_counts"}
            }
            for shard in sorted(shards, key=lambda item: item["path"])
        ],
        "render_levels": sorted(render_levels, key=lambda item: item["lod"]),
        "source_counts": dict(sorted(source_counts.items())),
    }
    (output / "dataset.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def compile_source(options: CompileOptions, adapter: ActivitySourceAdapter) -> dict[str, Any]:
    source, target = options.input_path.resolve(), options.output_path.resolve()
    if options.target_shard_rows < 1:
        raise ValueError("target shard rows must be positive")
    if options.row_group_rows < 1 or options.row_group_rows > options.target_shard_rows:
        raise ValueError("row group rows must be positive and no larger than the shard target")
    if target.exists() and not options.overwrite:
        raise FileExistsError(f"output already exists: {target}; pass --overwrite to replace it")
    parent = target.parent
    parent.mkdir(parents=True, exist_ok=True)
    with (
        tempfile.TemporaryDirectory(prefix="activity-map-source-") as source_tmp,
        tempfile.TemporaryDirectory(prefix=f".{target.name}-", dir=parent) as output_tmp,
    ):
        root = adapter.prepare(source, Path(source_tmp))
        records, rejects = adapter.records(root)
        if not records:
            raise ValueError("no supported activity files were discovered")
        ray.init(
            num_cpus=options.num_cpus,
            include_dashboard=False,
            ignore_reinit_error=True,
            log_to_driver=False,
            _skip_env_hook=True,
        )
        try:
            progress: Any = (
                ray.remote(num_cpus=0)(_ProgressCounter).remote()
                if options.progress_callback
                else None
            )
            pending = ray.data.from_items(records).map_batches(
                _process_batch,
                batch_size=options.batch_size,
                batch_format="pyarrow",
                fn_kwargs={"progress": progress},
            )
            if options.progress_callback and progress is not None:
                with ThreadPoolExecutor(max_workers=1) as executor:
                    materialized = executor.submit(pending.materialize)
                    while not materialized.done():
                        completed = cast(int, ray.get(progress.value.remote()))
                        options.progress_callback(completed, len(records))
                        time.sleep(5)
                    batches = materialized.result()
                options.progress_callback(len(records), len(records))
            else:
                batches = pending.materialize()
            accepted = batches.map_batches(_accepted_batch, batch_format="pyarrow")
            activity_count = accepted.count()
            if activity_count:
                if options.num_cpus == 1:
                    # Ray's hash-shuffle aggregator requires a second scheduling slot.
                    # Preserve the single-CPU development/test path without deadlocking.
                    partitioned = accepted.sort(
                        ["activity_family", "spatial_order", "activity_id"]
                    ).repartition(target_num_rows_per_block=options.target_shard_rows)
                else:
                    partitioned = accepted.groupby(["activity_family"]).map_groups(
                        _partition_batch, batch_format="pyarrow"
                    )
                sink = GeoParquetDataSink(
                    str(Path(output_tmp) / "activities"),
                    row_group_size=options.row_group_rows,
                    target_shard_rows=options.target_shard_rows,
                )
                partitioned.write_datasink(sink)
                render_sink = RenderPyramidDataSink(str(Path(output_tmp) / "render"))
                accepted.sort(["spatial_order", "activity_id"]).repartition(1).write_datasink(
                    render_sink
                )
            rejected = batches.map_batches(_rejected_batch, batch_format="pyarrow")
            for row in rejected.iter_rows():
                rejects.append(dict(row))
        finally:
            ray.shutdown()
        if not activity_count:
            raise ValueError("no valid spatial activities were produced")
        manifest = _finalize_dataset(rejects, Path(output_tmp), sink.shards, render_sink.levels)
        validate_dataset(Path(output_tmp))
        rate = len(rejects) / (activity_count + len(rejects))
        if options.max_rejections is not None and len(rejects) > options.max_rejections:
            raise ValueError("rejection count exceeds configured threshold")
        if options.max_rejection_rate is not None and rate > options.max_rejection_rate:
            raise ValueError("rejection rate exceeds configured threshold")
        if target.exists():
            shutil.rmtree(target)
        shutil.move(output_tmp, target)
        return manifest


def compile_strava(options: CompileOptions) -> dict[str, Any]:
    return compile_source(options, StravaSourceAdapter())


def validate_dataset(path: Path) -> dict[str, Any]:
    manifest_path = path / "dataset.json"
    if not manifest_path.is_file():
        raise ValueError("dataset.json is missing")
    manifest: dict[str, Any] = json.loads(manifest_path.read_text())
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("unsupported dataset schema version")
    shards = manifest.get("shards", [])
    if not shards:
        raise ValueError("manifest contains no activity shards")
    render_levels = manifest.get("render_levels", [])
    if [level.get("lod") for level in render_levels] != list(range(5)):
        raise ValueError("manifest must contain render levels 0 through 4")
    for shard in shards:
        file = path / shard["path"]
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != shard["sha256"]:
            raise ValueError(f"missing or invalid shard: {shard['path']}")
        table = pq.ParquetFile(file).read()
        validate_arrow_table(table)
        metadata = pq.read_schema(file).metadata or {}
        if b"geo" not in metadata:
            raise ValueError(f"GeoParquet metadata missing: {shard['path']}")
        for geometry, target in {
            "geometry_lod0": 40,
            "geometry_lod1": 100,
            "geometry_lod2": 400,
            "geometry_lod3": 2000,
            "geometry_clean_lod0": 40,
            "geometry_clean_lod1": 100,
            "geometry_clean_lod2": 400,
            "geometry_clean_lod3": 2000,
        }.items():
            maximum = pc.max(pc.list_value_length(table[geometry])).as_py()
            if maximum is not None and maximum > target:
                raise ValueError(f"LOD target exceeded in {shard['path']}: {geometry}")
    for level in render_levels:
        file = path / level["path"]
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != level["sha256"]:
            raise ValueError(f"missing or invalid render level: {level['path']}")
        table = pq.ParquetFile(file).read()
        if table.num_rows != manifest["activity_count"]:
            raise ValueError(f"render level row count differs: {level['path']}")
        if not pc.all(
            pc.equal(pc.list_value_length(table["geometry"]), table["vertex_count"])
        ).as_py():
            raise ValueError(f"render vertex counts differ: {level['path']}")
        if not pc.all(
            pc.equal(pc.list_value_length(table["geometry_clean"]), table["clean_vertex_count"])
        ).as_py():
            raise ValueError(f"clean render vertex counts differ: {level['path']}")
        if b"geo" not in (pq.read_schema(file).metadata or {}):
            raise ValueError(f"GeoParquet metadata missing: {level['path']}")
    pattern = str(path / "activities" / "activity_family=*" / "*.parquet")
    connection = duckdb.connect()
    endpoint_checks = " OR ".join(
        f"list_first({prefix}_lod{level}) <> list_first({prefix}) OR "
        f"list_last({prefix}_lod{level}) <> list_last({prefix})"
        for prefix in ("geometry", "geometry_clean")
        for level in range(4)
    )
    result = connection.execute(
        f"""SELECT count(*), count(DISTINCT activity_id), count(*) FILTER (WHERE
        list_count(list_filter(track_points, point -> point.clean)) <> clean_point_count OR
        clean_point_count + dropped_jump_points + dropped_elevation_points <> point_count OR
        array_length(geometry) <> point_count OR
        array_length(geometry_clean) <> clean_point_count OR
        {endpoint_checks})
        FROM read_parquet(?, hive_partitioning=true)""",
        [pattern],
    ).fetchone()
    if result is None:
        raise ValueError("DuckDB dataset validation returned no result")
    count, distinct, clean_mismatches = result
    if count != manifest["activity_count"] or count != distinct:
        raise ValueError("activity count or identifier uniqueness validation failed")
    if clean_mismatches:
        raise ValueError("clean point flags or rejection counts do not balance")
    return manifest
