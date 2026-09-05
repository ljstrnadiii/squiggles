from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, cast

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from pandera.typing.pyarrow import Table
from ray.data._internal.execution.interfaces import TaskContext
from ray.data.block import Block, BlockAccessor
from ray.data.datasource import Datasink
from ray.data.datasource.datasink import WriteResult

from .render_lod import RENDER_TOLERANCES_M, simplify_coordinates_meters
from .schema import (
    ActivitySchema,
    RenderActivitySchema,
    activity_arrow_schema,
    geo_metadata,
    render_arrow_schema,
    render_geo_metadata,
    validate_arrow_table,
    validate_render_table,
)

ShardMetadata = dict[str, Any]
RENDER_ROW_GROUP_TARGET_BYTES = 4 * 1024 * 1024
RENDER_FILE_TARGET_BYTES = 1024 * 1024 * 1024
RENDER_SCALARS = [
    "activity_id",
    "name",
    "sport_type",
    "start_time",
    "start_year",
    "activity_family",
    "distance_m",
    "elevation_gain_m",
    "max_elevation_m",
    "clean_distance_m",
    "clean_elevation_gain_m",
    "clean_max_elevation_m",
    "source_url",
    "xmin",
    "ymin",
    "xmax",
    "ymax",
    "clean_xmin",
    "clean_ymin",
    "clean_xmax",
    "clean_ymax",
    "point_count",
    "clean_point_count",
]


def _byte_groups(
    table: Table[RenderActivitySchema], target_bytes: int
) -> list[Table[RenderActivitySchema]]:
    """Split a table into whole-activity groups near a target uncompressed size."""
    groups: list[Table[RenderActivitySchema]] = []
    start = 0
    estimated_bytes = 0
    for index in range(table.num_rows):
        row_bytes = max(1, table.slice(index, 1).nbytes)
        if index > start and estimated_bytes + row_bytes > target_bytes:
            groups.append(cast(Table[RenderActivitySchema], table.slice(start, index - start)))
            start = index
            estimated_bytes = 0
        estimated_bytes += row_bytes
    if start < table.num_rows:
        groups.append(cast(Table[RenderActivitySchema], table.slice(start)))
    return groups


def _table_bounds(table: pa.Table) -> list[float]:
    return [
        pc.min(table["xmin"]).as_py(),
        pc.min(table["ymin"]).as_py(),
        pc.max(table["xmax"]).as_py(),
        pc.max(table["ymax"]).as_py(),
    ]


def _render_geometry(
    column: pa.ChunkedArray, tolerance_m: float | None
) -> pa.Array | pa.ChunkedArray:
    if tolerance_m is None:
        return column
    return pa.array(
        [simplify_coordinates_meters(value, tolerance_m) for value in column.to_pylist()],
        type=column.type,
    )


def _row_group_metadata(table: Table[RenderActivitySchema]) -> ShardMetadata:
    vertex = table["vertex_count"]
    clean_vertex = table["clean_vertex_count"]
    return {
        "row_count": table.num_rows,
        "bbox": _table_bounds(table),
        "estimated_uncompressed_bytes": table.nbytes,
        "vertex_count": {
            "sum": pc.sum(vertex).as_py(),
            "min": pc.min(vertex).as_py(),
            "max": pc.max(vertex).as_py(),
        },
        "clean_vertex_count": {
            "sum": pc.sum(clean_vertex).as_py(),
            "min": pc.min(clean_vertex).as_py(),
            "max": pc.max(clean_vertex).as_py(),
        },
    }


def _write_render_file(
    row_groups: list[Table[RenderActivitySchema]], root: Path, relative: Path
) -> ShardMetadata:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    output = pa.BufferOutputStream()
    with pq.ParquetWriter(output, row_groups[0].schema, compression="zstd") as writer:
        for row_group in row_groups:
            writer.write_table(row_group, row_group_size=row_group.num_rows)
    payload = output.getvalue()
    with target.open("wb") as handle:
        handle.write(memoryview(payload))
    metadata = [_row_group_metadata(group) for group in row_groups]
    return {
        "path": f"render/{relative.as_posix()}",
        "row_count": sum(group.num_rows for group in row_groups),
        "byte_size": payload.size,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bbox": [
            min(group["bbox"][0] for group in metadata),
            min(group["bbox"][1] for group in metadata),
            max(group["bbox"][2] for group in metadata),
            max(group["bbox"][3] for group in metadata),
        ],
        "row_group_count": len(metadata),
        "row_groups": metadata,
    }


def _render_partitions(
    table: Table[RenderActivitySchema], lod: int
) -> list[tuple[Path, Table[RenderActivitySchema]]]:
    """Keep coarse global LODs contiguous; partition larger detail levels for pruning."""
    base = Path(f"lod={lod}")
    if lod <= 2:
        return [(base, table)]

    partitions: list[tuple[Path, Table[RenderActivitySchema]]] = []
    families = sorted(set(table["activity_family"].to_pylist()))
    for family in families:
        family_table = table.filter(pc.equal(table["activity_family"], family))
        years = sorted(set(int(value) for value in family_table["start_year"].to_pylist()))
        for year in years:
            year_table = cast(
                Table[RenderActivitySchema],
                family_table.filter(pc.equal(family_table["start_year"], year)).sort_by(
                    [("spatial_order", "ascending"), ("activity_id", "ascending")]
                ),
            )
            partitions.append(
                (base / f"activity_family={family}" / f"start_year={year}", year_table)
            )
    return partitions


def _render_files(
    table: Table[RenderActivitySchema], root: Path, partition_path: Path
) -> list[ShardMetadata]:
    row_groups = _byte_groups(table, RENDER_ROW_GROUP_TARGET_BYTES)
    files: list[ShardMetadata] = []
    pending: list[Table[RenderActivitySchema]] = []
    pending_bytes = 0
    sequence = 0

    def flush() -> None:
        nonlocal pending, pending_bytes, sequence
        if not pending:
            return
        files.append(
            _write_render_file(
                pending,
                root,
                partition_path / f"part-{sequence:05d}.parquet",
            )
        )
        pending = []
        pending_bytes = 0
        sequence += 1

    for row_group in row_groups:
        if pending and pending_bytes + row_group.nbytes > RENDER_FILE_TARGET_BYTES:
            flush()
        pending.append(row_group)
        pending_bytes += row_group.nbytes
    flush()
    return files


def write_render_pyramid(
    table: pa.Table, path: Path, progress_callback: Callable[[int, int], None] | None = None
) -> list[ShardMetadata]:
    """Write immutable Hive-partitioned render artifacts from canonical geometry."""
    path.mkdir(parents=True, exist_ok=True)
    combined = table.sort_by([("spatial_order", "ascending"), ("activity_id", "ascending")])
    levels: list[ShardMetadata] = []
    for lod, tolerance_m in enumerate(RENDER_TOLERANCES_M):
        geometry = _render_geometry(combined["geometry"], tolerance_m)
        clean_geometry = _render_geometry(combined["geometry_clean"], tolerance_m)
        arrays = [combined[name] for name in RENDER_SCALARS]
        arrays.extend(
            [
                combined["spatial_order"],
                pc.cast(pc.list_value_length(geometry), pa.int64()),
                pc.cast(pc.list_value_length(clean_geometry), pa.int64()),
                geometry,
                clean_geometry,
            ]
        )
        render = cast(
            Table[RenderActivitySchema], pa.Table.from_arrays(arrays, schema=render_arrow_schema())
        )
        render = validate_render_table(render)
        render = cast(
            Table[RenderActivitySchema],
            render.replace_schema_metadata(
                {**(render.schema.metadata or {}), **render_geo_metadata(_table_bounds(render))}
            ),
        )

        files: list[ShardMetadata] = []
        for partition_path, partition in _render_partitions(render, lod):
            files.extend(_render_files(partition, path, partition_path))

        levels.append(
            {
                "lod": lod,
                "tolerance_m": tolerance_m,
                "row_count": render.num_rows,
                "byte_size": sum(int(file["byte_size"]) for file in files),
                "bbox": _table_bounds(render),
                "file_count": len(files),
                "row_group_count": sum(int(file["row_group_count"]) for file in files),
                "files": files,
            }
        )
        if progress_callback:
            progress_callback(lod + 1, len(RENDER_TOLERANCES_M))
    return levels


class GeoParquetDataSink(Datasink[list[ShardMetadata]]):
    """Ray datasink that writes canonical, Hive-partitioned GeoParquet shards."""

    def __init__(
        self, path: str, *, row_group_size: int = 128, target_shard_rows: int = 512
    ) -> None:
        self.path = path
        self.row_group_size = row_group_size
        self.target_shard_rows = target_shard_rows
        self.shards: list[ShardMetadata] = []

    def on_write_start(self, schema: pa.Schema | None = None) -> None:
        Path(self.path).mkdir(parents=True, exist_ok=True)

    def write(self, blocks: Iterable[Block], ctx: TaskContext) -> list[ShardMetadata]:
        tables = [
            BlockAccessor.for_block(block).to_arrow()
            for block in blocks
            if BlockAccessor.for_block(block).num_rows() > 0
        ]
        if not tables:
            return []
        combined = pa.concat_tables(tables)
        partitions = set(combined["activity_family"].to_pylist())
        shards: list[ShardMetadata] = []
        for sequence, activity_family in enumerate(sorted(partitions)):
            mask = pc.equal(combined["activity_family"], activity_family)
            partition = combined.filter(mask).drop_columns(["activity_family"])
            partition = partition.sort_by(
                [("spatial_order", "ascending"), ("activity_id", "ascending")]
            )
            directory = Path(self.path) / f"activity_family={activity_family}"
            directory.mkdir(parents=True, exist_ok=True)
            for chunk_index, offset in enumerate(
                range(0, partition.num_rows, self.target_shard_rows)
            ):
                table = partition.slice(offset, self.target_shard_rows)
                canonical = cast(Table[ActivitySchema], table.cast(activity_arrow_schema()))
                canonical = validate_arrow_table(canonical)
                bounds = _table_bounds(canonical)
                row_groups = [
                    {
                        "row_count": group.num_rows,
                        "bbox": _table_bounds(group),
                    }
                    for group in (
                        canonical.slice(group_offset, self.row_group_size)
                        for group_offset in range(0, canonical.num_rows, self.row_group_size)
                    )
                ]
                canonical = cast(
                    Table[ActivitySchema],
                    canonical.replace_schema_metadata(
                        {**(canonical.schema.metadata or {}), **geo_metadata(bounds)}
                    ),
                )
                target = directory / (
                    f"part-{ctx.task_idx:05d}-{sequence:03d}-{chunk_index:03d}.parquet"
                )
                output = pa.BufferOutputStream()
                pq.write_table(
                    canonical,
                    output,
                    compression="zstd",
                    row_group_size=self.row_group_size,
                )
                payload = output.getvalue()
                with target.open("wb") as handle:
                    handle.write(memoryview(payload))
                source_counts = Counter(canonical["source_type"].to_pylist())
                shards.append(
                    {
                        "path": f"activities/{target.relative_to(self.path).as_posix()}",
                        "row_count": canonical.num_rows,
                        "byte_size": payload.size,
                        "sha256": hashlib.sha256(payload).hexdigest(),
                        "bbox": bounds,
                        "row_group_count": len(row_groups),
                        "row_groups": row_groups,
                        "first_activity": pc.min(canonical["start_time"]).as_py().isoformat(),
                        "last_activity": pc.max(canonical["start_time"]).as_py().isoformat(),
                        "source_counts": dict(source_counts),
                    }
                )
        return shards

    def on_write_complete(self, write_result: WriteResult[list[ShardMetadata]]) -> None:
        self.shards = [shard for result in write_result.write_returns for shard in result]


class RenderPyramidDataSink(Datasink[list[ShardMetadata]]):
    """Write one Hive-partitioned render dataset containing every fixed-tolerance LOD."""

    def __init__(self, path: str) -> None:
        self.path = path
        self.levels: list[ShardMetadata] = []

    def on_write_start(self, schema: pa.Schema | None = None) -> None:
        Path(self.path).mkdir(parents=True, exist_ok=True)

    def write(self, blocks: Iterable[Block], ctx: TaskContext) -> list[ShardMetadata]:
        tables = [
            BlockAccessor.for_block(block).to_arrow()
            for block in blocks
            if BlockAccessor.for_block(block).num_rows() > 0
        ]
        if not tables:
            return []
        return write_render_pyramid(pa.concat_tables(tables), Path(self.path))

    def on_write_complete(self, write_result: WriteResult[list[ShardMetadata]]) -> None:
        self.levels = [level for result in write_result.write_returns for level in result]
