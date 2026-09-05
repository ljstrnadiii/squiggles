from pathlib import Path
import re


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))


def sub(path: str, pattern: str, repl: str) -> None:
    p = Path(path)
    text = p.read_text()
    text2, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"pattern count {count} in {path}: {pattern[:80]!r}")
    p.write_text(text2)


# Schema/layout bump and separate metadata/overview schemas.
replace("packages/ingest/src/activity_map_ingest/schema.py", 'SCHEMA_VERSION = "1.4.0"', 'SCHEMA_VERSION = "1.5.0"')
sub(
    "packages/ingest/src/activity_map_ingest/schema.py",
    r'class RenderActivitySchema\(pa_model\.DataFrameModel\):.*?\n\n\ndef activity_arrow_schema',
    '''class RenderActivitySchema(pa_model.DataFrameModel):\n    activity_id: str\n    spatial_order: int = pa_model.Field(ge=0)\n    vertex_count: int = pa_model.Field(ge=2)\n    clean_vertex_count: int = pa_model.Field(ge=2)\n\n    class Config:\n        strict = False\n\n\ndef activity_arrow_schema''',
)
sub(
    "packages/ingest/src/activity_map_ingest/schema.py",
    r'def render_arrow_schema\(\) -> pa\.Schema:.*?\n\n\ndef render_geo_metadata',
    '''def metadata_arrow_schema() -> pa.Schema:\n    canonical = activity_arrow_schema()\n    fields = [field for field in canonical if field.name not in {*GEOMETRY_COLUMNS, "track_points"}]\n    return pa.schema([*fields, pa.field("activity_family", pa.string(), False)])\n\n\ndef render_arrow_schema() -> pa.Schema:\n    canonical = activity_arrow_schema()\n    names = [\n        "activity_id",\n        "xmin", "ymin", "xmax", "ymax",\n        "clean_xmin", "clean_ymin", "clean_xmax", "clean_ymax",\n    ]\n    fields = [canonical.field(name) for name in names]\n    geometry_metadata = {\n        b"ARROW:extension:name": b"geoarrow.linestring",\n        b"ARROW:extension:metadata": json.dumps({"crs": "OGC:CRS84"}).encode(),\n    }\n    return pa.schema([\n        *fields,\n        pa.field("spatial_order", pa.int64(), False),\n        pa.field("vertex_count", pa.int64(), False),\n        pa.field("clean_vertex_count", pa.int64(), False),\n        pa.field("geometry", line_type, False, metadata=geometry_metadata),\n        pa.field("geometry_clean", line_type, False, metadata=geometry_metadata),\n    ])\n\n\ndef render_geo_metadata''',
)

# Render artifacts become geometry/index only; metadata gets its own Parquet relation.
replace(
    "packages/ingest/src/activity_map_ingest/geoparquet_sink.py",
    "    render_arrow_schema,\n",
    "    metadata_arrow_schema,\n    render_arrow_schema,\n",
)
sub(
    "packages/ingest/src/activity_map_ingest/geoparquet_sink.py",
    r'RENDER_SCALARS = \[.*?\]\n',
    '''RENDER_SCALARS = [\n    "activity_id",\n    "xmin", "ymin", "xmax", "ymax",\n    "clean_xmin", "clean_ymin", "clean_xmax", "clean_ymax",\n]\n''',
)
sub(
    "packages/ingest/src/activity_map_ingest/geoparquet_sink.py",
    r'def _secondary_order\(table: Table\[RenderActivitySchema\]\) -> Table\[RenderActivitySchema\]:.*?\n\n\ndef _table_bounds',
    '''def _secondary_order(table: Table[RenderActivitySchema]) -> Table[RenderActivitySchema]:\n    return cast(Table[RenderActivitySchema], table.sort_by([("activity_id", "ascending")]))\n\n\ndef _table_bounds''',
)
insert = '''\n\ndef write_metadata_dataset(table: pa.Table, path: Path) -> list[ShardMetadata]:\n    path.mkdir(parents=True, exist_ok=True)\n    schema = metadata_arrow_schema()\n    ordered = table.sort_by([("spatial_order", "ascending"), ("activity_id", "ascending")])\n    metadata = ordered.select(schema.names).cast(schema)\n    target = path / "part-00000.parquet"\n    row_group_size = 4096\n    pq.write_table(metadata, target, compression="zstd", row_group_size=row_group_size)\n    groups = [\n        metadata.slice(offset, row_group_size)\n        for offset in range(0, metadata.num_rows, row_group_size)\n    ]\n    row_groups = [{"row_count": group.num_rows, "bbox": _table_bounds(group)} for group in groups]\n    return [{\n        "path": "metadata/part-00000.parquet",\n        "row_count": metadata.num_rows,\n        "byte_size": target.stat().st_size,\n        "sha256": _file_sha256(target),\n        "bbox": _table_bounds(metadata),\n        "row_group_count": len(row_groups),\n        "row_groups": row_groups,\n    }]\n\n\nclass MetadataDataSink(Datasink[list[ShardMetadata]]):\n    def __init__(self, path: str) -> None:\n        self.path = path\n        self.files: list[ShardMetadata] = []\n\n    def on_write_start(self, schema: pa.Schema | None = None) -> None:\n        Path(self.path).mkdir(parents=True, exist_ok=True)\n\n    def write(self, blocks: Iterable[Block], ctx: TaskContext) -> list[ShardMetadata]:\n        tables = [BlockAccessor.for_block(block).to_arrow() for block in blocks if BlockAccessor.for_block(block).num_rows() > 0]\n        if not tables:\n            return []\n        return write_metadata_dataset(pa.concat_tables(tables), Path(self.path))\n\n    def on_write_complete(self, write_result: WriteResult[list[ShardMetadata]]) -> None:\n        self.files = [file for result in write_result.write_returns for file in result]\n'''
replace(
    "packages/ingest/src/activity_map_ingest/geoparquet_sink.py",
    "\n\nclass RenderPyramidDataSink(Datasink[list[ShardMetadata]]):",
    insert + "\n\nclass RenderPyramidDataSink(Datasink[list[ShardMetadata]]):",
)

# One format version governs metadata + overview artifacts.
replace("packages/ingest/src/activity_map_ingest/render_lod.py", 'RENDER_PYRAMID_VERSION = "3"', 'RENDER_PYRAMID_VERSION = "4"')
replace(
    "packages/ingest/src/activity_map_ingest/compiler.py",
    "from .geoparquet_sink import GeoParquetDataSink, RenderPyramidDataSink",
    "from .geoparquet_sink import GeoParquetDataSink, MetadataDataSink, RenderPyramidDataSink",
)
replace(
    "packages/ingest/src/activity_map_ingest/compiler.py",
    "    render_levels: list[dict[str, Any]],\n) -> dict[str, Any]:",
    "    metadata_files: list[dict[str, Any]],\n    render_levels: list[dict[str, Any]],\n) -> dict[str, Any]:",
)
replace(
    "packages/ingest/src/activity_map_ingest/compiler.py",
    '        "shards": [',
    '        "metadata": sorted(metadata_files, key=lambda item: item["path"]),\n        "shards": [',
)
replace(
    "packages/ingest/src/activity_map_ingest/compiler.py",
    '                render_sink = RenderPyramidDataSink(str(Path(output_tmp) / "render"))\n                accepted.sort(["spatial_order", "activity_id"]).repartition(1).write_datasink(\n                    render_sink\n                )',
    '                metadata_sink = MetadataDataSink(str(Path(output_tmp) / "metadata"))\n                accepted.sort(["spatial_order", "activity_id"]).repartition(1).write_datasink(\n                    metadata_sink\n                )\n                render_sink = RenderPyramidDataSink(str(Path(output_tmp) / "render"))\n                accepted.sort(["spatial_order", "activity_id"]).repartition(1).write_datasink(\n                    render_sink\n                )',
)
replace(
    "packages/ingest/src/activity_map_ingest/compiler.py",
    "        manifest = _finalize_dataset(rejects, Path(output_tmp), sink.shards, render_sink.levels)",
    "        manifest = _finalize_dataset(rejects, Path(output_tmp), sink.shards, metadata_sink.files, render_sink.levels)",
)
replace(
    "packages/ingest/src/activity_map_ingest/compiler.py",
    '    render_levels = manifest.get("render_levels", [])\n',
    '    metadata_files = manifest.get("metadata", [])\n    if not metadata_files:\n        raise ValueError("manifest contains no metadata files")\n    metadata_rows = 0\n    for entry in metadata_files:\n        file = path / entry["path"]\n        if not file.is_file() or _sha256_file(file) != entry["sha256"]:\n            raise ValueError(f"missing or invalid metadata file: {entry[\'path\']}")\n        table = pq.ParquetFile(file).read()\n        metadata_rows += table.num_rows\n        if any(name.startswith("geometry") or name == "track_points" for name in table.column_names):\n            raise ValueError(f"metadata file contains heavy columns: {entry[\'path\']}")\n    if metadata_rows != manifest["activity_count"]:\n        raise ValueError("metadata activity count differs")\n    render_levels = manifest.get("render_levels", [])\n',
)
sub(
    "packages/ingest/src/activity_map_ingest/compiler.py",
    r'        for geometry, target in \{.*?\n                raise ValueError\(f"LOD target exceeded in \{shard\[\'path\'\]\}: \{geometry\}"\)\n',
    '',
)
replace(
    "packages/ingest/src/activity_map_ingest/compiler.py",
    '            if not pc.all(\n                pc.equal(pc.list_value_length(table["geometry_clean"]), table["clean_vertex_count"])\n            ).as_py():\n                raise ValueError(f"clean render vertex counts differ: {entry[\'path\']}")\n',
    '            if not pc.all(\n                pc.equal(pc.list_value_length(table["geometry_clean"]), table["clean_vertex_count"])\n            ).as_py():\n                raise ValueError(f"clean render vertex counts differ: {entry[\'path\']}")\n            allowed = {"activity_id", "xmin", "ymin", "xmax", "ymax", "clean_xmin", "clean_ymin", "clean_xmax", "clean_ymax", "spatial_order", "vertex_count", "clean_vertex_count", "geometry", "geometry_clean"}\n            if set(table.column_names) != allowed:\n                raise ValueError(f"render file contains non-index metadata: {entry[\'path\']}")\n',
)

# Rebuild/publishing carries metadata alongside geometry overviews.
replace(
    "packages/ingest/src/activity_map_ingest/dataset_builds.py",
    "from .geoparquet_sink import write_render_pyramid",
    "from .geoparquet_sink import write_metadata_dataset, write_render_pyramid",
)
replace(
    "packages/ingest/src/activity_map_ingest/dataset_builds.py",
    '    for level in result.get("render_levels", []):',
    '    for entry in result.get("metadata", []):\n        entry["path"] = prefix + entry["path"]\n    for level in result.get("render_levels", []):',
)
replace(
    "packages/ingest/src/activity_map_ingest/dataset_builds.py",
    '    render_levels = write_render_pyramid(\n        pa.concat_tables(tables, promote_options="default"),\n        output / "render",\n        progress_callback=progress_callback,\n    )',
    '    combined = pa.concat_tables(tables, promote_options="default")\n    metadata_files = write_metadata_dataset(combined, output / "metadata")\n    render_levels = write_render_pyramid(\n        combined,\n        output / "render",\n        progress_callback=progress_callback,\n    )',
)
replace(
    "packages/ingest/src/activity_map_ingest/dataset_builds.py",
    '        "shards": normalized_shards,\n        "render_levels": render_levels,',
    '        "shards": normalized_shards,\n        "metadata": metadata_files,\n        "render_levels": render_levels,',
)

# Update compiler assertions/docs embedded in tests.
p = Path("packages/ingest/tests/test_ingest.py")
t = p.read_text().replace('"1.4.0"', '"1.5.0"').replace('"3"', '"4"').replace('schema-1.4.0-test', 'schema-1.5.0-test').replace('schema-1.4.0-', 'schema-1.5.0-')
anchor = '    levels = manifest["render_levels"]\n'
if anchor in t:
    t = t.replace(anchor, '    assert manifest["metadata"]\n    metadata_table = pq.ParquetFile(output / manifest["metadata"][0]["path"]).read()\n    assert "geometry" not in metadata_table.column_names\n    assert "track_points" not in metadata_table.column_names\n\n' + anchor, 1)
p.write_text(t)

# Query contract version; heavy columns are internal in v1.5.
p = Path("apps/web/src/querySchema.ts")
t = p.read_text().replace("schema 1.4.0", "schema 1.5.0")
start = t.find("geometry DOUBLE[2][] NOT NULL")
end = t.find("\n\nUnits:", start)
if start >= 0 and end >= 0:
    t = t[:start] + t[end+2:]
t = t.replace("Raw geometry, telemetry, and summaries remain canonical. When the Clean toggle is", "Full geometry and telemetry remain canonical and are internal detail data. When the Clean toggle is")
p.write_text(t)
