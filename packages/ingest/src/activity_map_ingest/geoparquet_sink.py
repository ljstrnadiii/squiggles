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

from .schema import ActivitySchema, activity_arrow_schema, geo_metadata, validate_arrow_table

ShardMetadata = dict[str, Any]


def _table_bounds(table: pa.Table) -> list[float]:
    return [
        pc.min(table["xmin"]).as_py(),
        pc.min(table["ymin"]).as_py(),
        pc.max(table["xmax"]).as_py(),
        pc.max(table["ymax"]).as_py(),
    ]


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
