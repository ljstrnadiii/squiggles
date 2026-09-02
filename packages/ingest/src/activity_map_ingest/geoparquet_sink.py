from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Iterable
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
RENDER_ROW_GROUP_TARGET_VERTICES = 1_000_000
RENDER_SCALARS = [
    "activity_id",
    "name",
    "sport_type",
    "start_time",
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


def _render_row_groups(
    table: Table[RenderActivitySchema],
) -> list[Table[RenderActivitySchema]]:
    raw = table["vertex_count"].to_pylist()
    clean = table["clean_vertex_count"].to_pylist()
    groups: list[Table[RenderActivitySchema]] = []
    start = 0
    vertices = 0
    for index, (raw_count, clean_count) in enumerate(zip(raw, clean, strict=True)):
        next_vertices = int(raw_count) + int(clean_count)
        if index > start and vertices + next_vertices > RENDER_ROW_GROUP_TARGET_VERTICES:
            groups.append(cast(Table[RenderActivitySchema], table.slice(start, index - start)))
            start = index
            vertices = 0
        vertices += next_vertices
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


def write_render_pyramid(table: pa.Table, path: Path) -> list[ShardMetadata]:
    """Write immutable render artifacts from full canonical geometry."""
    path.mkdir(parents=True, exist_ok=True)
    combined = table.sort_by([("spatial_order", "ascending"), ("activity_id", "ascending")])
    levels = []
    for lod, tolerance_m in enumerate(RENDER_TOLERANCES_M):
        geometry = _render_geometry(combined["geometry"], tolerance_m)
        clean_geometry = _render_geometry(combined["geometry_clean"], tolerance_m)
        arrays = [combined[name] for name in RENDER_SCALARS]
        arrays.extend(
            [
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
        payload_groups = _render_row_groups(render)
        row_groups = []
        for group in payload_groups:
            row_groups.append(
                {
                    "row_count": group.num_rows,
                    "bbox": _table_bounds(group),
                    "vertex_count": {
                        "sum": pc.sum(group["vertex_count"]).as_py(),
                        "min": pc.min(group["vertex_count"]).as_py(),
                        "max": pc.max(group["vertex_count"]).as_py(),
                    },
                    "clean_vertex_count": {
                        "sum": pc.sum(group["clean_vertex_count"]).as_py(),
                        "min": pc.min(group["clean_vertex_count"]).as_py(),
                        "max": pc.max(group["clean_vertex_count"]).as_py(),
                    },
                }
            )
        target = path / f"lod-{lod}.parquet"
        output = pa.BufferOutputStream()
        with pq.ParquetWriter(output, render.schema, compression="zstd") as writer:
            for group in payload_groups:
                writer.write_table(group, row_group_size=group.num_rows)
        payload = output.getvalue()
        with target.open("wb") as handle:
            handle.write(memoryview(payload))
        levels.append(
            {
                "lod": lod,
                "tolerance_m": tolerance_m,
                "path": f"render/{target.name}",
                "row_count": render.num_rows,
                "byte_size": payload.size,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "bbox": _table_bounds(render),
                "row_group_count": len(row_groups),
                "row_groups": row_groups,
            }
        )
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
    """Write one spatially ordered, render-only GeoParquet for every LOD."""

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
