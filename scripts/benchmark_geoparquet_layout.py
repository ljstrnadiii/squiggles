#!/usr/bin/env python3
"""Build and compare local GeoParquet layout candidates without publishing user data."""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

LEVELS = {
    0: ("geometry_lod0", "geometry_clean_lod0"),
    1: ("geometry_lod1", "geometry_clean_lod1"),
    2: ("geometry_lod2", "geometry_clean_lod2"),
    3: ("geometry_lod3", "geometry_clean_lod3"),
    4: ("geometry", "geometry_clean"),
}
ROW_GROUP_TARGET_VERTICES = 1_000_000
RENDER_COLUMNS = [
    "activity_id",
    "name",
    "sport_type",
    "start_time",
    "distance_m",
    "elevation_gain_m",
    "max_elevation_m",
    "source_url",
    "xmin",
    "ymin",
    "xmax",
    "ymax",
    "clean_xmin",
    "clean_ymin",
    "clean_xmax",
    "clean_ymax",
]


def activity_family(path: Path) -> str:
    return next(part.split("=", 1)[1] for part in path.parts if part.startswith("activity_family="))


def read_source(root: Path, manifest: dict[str, Any]) -> pa.Table:
    tables: list[pa.Table] = []
    for shard in manifest["shards"]:
        path = root / shard["path"]
        table = pq.ParquetFile(path).read()
        if "activity_family" not in table.column_names:
            table = table.append_column(
                "activity_family", pa.array([activity_family(path)] * table.num_rows)
            )
        tables.append(table)
    return pa.concat_tables(tables).sort_by(
        [
            ("activity_family", "ascending"),
            ("spatial_order", "ascending"),
            ("activity_id", "ascending"),
        ]
    )


def bounds(table: pa.Table, clean: bool = False) -> list[float]:
    prefix = "clean_" if clean else ""
    return [
        pc.min(table[f"{prefix}xmin"]).as_py(),
        pc.min(table[f"{prefix}ymin"]).as_py(),
        pc.max(table[f"{prefix}xmax"]).as_py(),
        pc.max(table[f"{prefix}ymax"]).as_py(),
    ]


def payload_groups(table: pa.Table) -> list[pa.Table]:
    groups = []
    start = 0
    vertices = 0
    counts = pc.add(table["vertex_count"], table["clean_vertex_count"]).to_pylist()
    for index, count in enumerate(counts):
        if index > start and vertices + count > ROW_GROUP_TARGET_VERTICES:
            groups.append(table.slice(start, index - start))
            start = index
            vertices = 0
        vertices += count
    if start < table.num_rows:
        groups.append(table.slice(start))
    return groups


def row_group_metadata(groups: list[pa.Table]) -> list[dict[str, Any]]:
    metadata = []
    for group in groups:
        counts = group["vertex_count"]
        clean_counts = group["clean_vertex_count"]
        metadata.append(
            {
                "row_count": group.num_rows,
                "bbox": bounds(group),
                "vertex_count": {
                    "sum": pc.sum(counts).as_py(),
                    "min": pc.min(counts).as_py(),
                    "max": pc.max(counts).as_py(),
                },
                "clean_vertex_count": {
                    "sum": pc.sum(clean_counts).as_py(),
                    "min": pc.min(clean_counts).as_py(),
                    "max": pc.max(clean_counts).as_py(),
                },
            }
        )
    return metadata


def write_candidates(table: pa.Table, output: Path) -> list[dict[str, Any]]:
    output.mkdir(parents=True, exist_ok=True)
    candidates: list[dict[str, Any]] = []
    for size in (128, 512):
        path = output / f"canonical-rg{size}.parquet"
        pq.write_table(table, path, compression="zstd", row_group_size=size)
        candidates.append({"kind": "canonical", "row_group_rows": size, "path": path})
    level_manifest = []
    for level, (geometry, clean_geometry) in LEVELS.items():
        render = table.select([*RENDER_COLUMNS, geometry, clean_geometry])
        render = render.rename_columns([*RENDER_COLUMNS, "geometry", "geometry_clean"])
        render = render.append_column("vertex_count", pc.list_value_length(render["geometry"]))
        render = render.append_column(
            "clean_vertex_count", pc.list_value_length(render["geometry_clean"])
        )
        path = output / f"render-lod{level}.parquet"
        groups = payload_groups(render)
        with pq.ParquetWriter(path, render.schema, compression="zstd") as writer:
            for group in groups:
                writer.write_table(group, row_group_size=group.num_rows)
        metadata = row_group_metadata(groups)
        level_manifest.append(
            {
                "lod": level,
                "path": path.name,
                "byte_size": path.stat().st_size,
                "row_group_target_vertices": ROW_GROUP_TARGET_VERTICES,
                "row_groups": metadata,
            }
        )
        candidates.append(
            {
                "kind": f"render-lod{level}",
                "row_group_target_vertices": ROW_GROUP_TARGET_VERTICES,
                "path": path,
            }
        )
    (output / "render-levels.json").write_text(json.dumps(level_manifest, indent=2) + "\n")
    return candidates


def dense_objective(table: pa.Table) -> tuple[float, float, float, float]:
    width = 0.02
    centers_x = pc.divide(pc.add(table["xmin"], table["xmax"]), 2).to_pylist()
    centers_y = pc.divide(pc.add(table["ymin"], table["ymax"]), 2).to_pylist()
    cells: dict[tuple[int, int], int] = {}
    for x, y in zip(centers_x, centers_y, strict=True):
        key = (int(x // width), int(y // width))
        cells[key] = cells.get(key, 0) + 1
    cell = max(cells, key=cells.__getitem__)
    return (cell[0] * width, cell[1] * width, (cell[0] + 1) * width, (cell[1] + 1) * width)


def timed(connection: duckdb.DuckDBPyConnection, query: str, repeats: int) -> dict[str, float]:
    connection.sql(query).fetchall()
    samples = []
    for _ in range(repeats):
        started = time.perf_counter()
        connection.sql(query).fetchall()
        samples.append((time.perf_counter() - started) * 1000)
    return {"median_ms": round(statistics.median(samples), 2), "minimum_ms": round(min(samples), 2)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--repeats", type=int, default=6)
    args = parser.parse_args()
    manifest = json.loads((args.source / "dataset.json").read_text())
    source = read_source(args.source, manifest)
    candidates = write_candidates(source, args.output)
    west, south, east, north = dense_objective(source)
    predicate = f"xmax >= {west} AND xmin <= {east} AND ymax >= {south} AND ymin <= {north}"
    connection = duckdb.connect()
    results = []
    current_paths = [str(args.source / shard["path"]) for shard in manifest["shards"]]
    current_sql = (
        "SELECT count(*),sum(len(geometry_lod2)) "
        f"FROM read_parquet({current_paths!r},hive_partitioning=true) WHERE {predicate}"
    )
    results.append(
        {
            "kind": "current-shards-lod2",
            "files": len(current_paths),
            "bytes": sum(shard["byte_size"] for shard in manifest["shards"]),
            **timed(connection, current_sql, args.repeats),
        }
    )
    for candidate in candidates:
        geometry = "geometry" if str(candidate["kind"]).startswith("render-") else "geometry_lod2"
        query = (
            f"SELECT count(*),sum(len({geometry})) "
            f"FROM read_parquet('{candidate['path']}') WHERE {predicate}"
        )
        results.append(
            {
                "kind": candidate["kind"],
                "files": 1,
                "bytes": candidate["path"].stat().st_size,
                **(
                    {"row_group_rows": candidate["row_group_rows"]}
                    if "row_group_rows" in candidate
                    else {"row_group_target_vertices": candidate["row_group_target_vertices"]}
                ),
                **timed(connection, query, args.repeats),
            }
        )
    print(json.dumps({"activity_count": source.num_rows, "results": results}, indent=2))


if __name__ == "__main__":
    main()
