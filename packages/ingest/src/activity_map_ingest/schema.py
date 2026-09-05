from __future__ import annotations

import json
from typing import Any

import pandera.pyarrow as pa_model
import pyarrow as pa
from pandera.typing.pyarrow import Table

SCHEMA_VERSION = "1.5.0"
GEOMETRY_COLUMNS = (
    "geometry",
    "geometry_lod0",
    "geometry_lod1",
    "geometry_lod2",
    "geometry_lod3",
    "geometry_clean",
    "geometry_clean_lod0",
    "geometry_clean_lod1",
    "geometry_clean_lod2",
    "geometry_clean_lod3",
)

point_type = pa.struct(
    [
        pa.field("sequence", pa.int32(), nullable=False),
        pa.field("timestamp", pa.timestamp("us", tz="UTC")),
        pa.field("longitude", pa.float64(), nullable=False),
        pa.field("latitude", pa.float64(), nullable=False),
        pa.field("elevation_m", pa.float64()),
        pa.field("heart_rate", pa.float64()),
        pa.field("cadence", pa.float64()),
        pa.field("power", pa.float64()),
        pa.field("clean", pa.bool_(), nullable=False),
    ]
)
line_type = pa.list_(pa.list_(pa.float64(), 2))


class ActivitySchema(pa_model.DataFrameModel):
    activity_id: str
    source_activity_id: str | None = pa_model.Field(nullable=True)
    source_filename: str
    source_type: str
    source_checksum: str
    schema_version: str
    compiler_version: str
    name: str
    sport_type: str
    original_start_time: str | None = pa_model.Field(nullable=True)
    source_url: str | None = pa_model.Field(nullable=True)
    distance_m: float | None = pa_model.Field(nullable=True, ge=0)
    elapsed_seconds: float | None = pa_model.Field(nullable=True, ge=0)
    moving_seconds: float | None = pa_model.Field(nullable=True, ge=0)
    elevation_gain_m: float | None = pa_model.Field(nullable=True, ge=0)
    elevation_loss_m: float | None = pa_model.Field(nullable=True, ge=0)
    min_elevation_m: float | None = pa_model.Field(nullable=True)
    max_elevation_m: float | None = pa_model.Field(nullable=True)
    point_count: int = pa_model.Field(ge=2)
    clean_point_count: int = pa_model.Field(ge=2)
    dropped_jump_points: int = pa_model.Field(ge=0)
    dropped_elevation_points: int = pa_model.Field(ge=0)
    xmin: float = pa_model.Field(ge=-180, le=180)
    ymin: float = pa_model.Field(ge=-90, le=90)
    xmax: float = pa_model.Field(ge=-180, le=180)
    ymax: float = pa_model.Field(ge=-90, le=90)
    spatial_order: int = pa_model.Field(ge=0)
    distance_source: str
    moving_time_source: str
    elevation_source: str
    start_year: int = pa_model.Field(ge=1970, le=9999)
    start_month: int = pa_model.Field(ge=1, le=12)

    class Config:
        strict = False


class ProcessingSchema(pa_model.DataFrameModel):
    activity_id: str | None = pa_model.Field(nullable=True)
    start_year: int | None = pa_model.Field(nullable=True)
    start_month: int | None = pa_model.Field(nullable=True)
    _rejection: str | None = pa_model.Field(nullable=True)

    class Config:
        strict = False


class RejectionSchema(pa_model.DataFrameModel):
    source_path: str
    source_activity_id: str | None = pa_model.Field(nullable=True)
    stage: str
    reason_code: str
    message: str


class RenderActivitySchema(pa_model.DataFrameModel):
    activity_id: str
    spatial_order: int = pa_model.Field(ge=0)
    vertex_count: int = pa_model.Field(ge=2)
    clean_vertex_count: int = pa_model.Field(ge=2)

    class Config:
        strict = False


def activity_arrow_schema() -> pa.Schema:
    scalar = [
        pa.field("activity_id", pa.string(), False),
        pa.field("source_activity_id", pa.string()),
        pa.field("source_filename", pa.string(), False),
        pa.field("source_type", pa.string(), False),
        pa.field("source_checksum", pa.string(), False),
        pa.field("schema_version", pa.string(), False),
        pa.field("compiler_version", pa.string(), False),
        pa.field("name", pa.string(), False),
        pa.field("sport_type", pa.string(), False),
        pa.field("start_time", pa.timestamp("us", tz="UTC")),
        pa.field("end_time", pa.timestamp("us", tz="UTC")),
        pa.field("start_year", pa.int64(), False),
        pa.field("start_month", pa.int64(), False),
        pa.field("original_start_time", pa.string()),
        pa.field("source_url", pa.string()),
        pa.field("distance_m", pa.float64()),
        pa.field("elapsed_seconds", pa.float64()),
        pa.field("moving_seconds", pa.float64()),
        pa.field("elevation_gain_m", pa.float64()),
        pa.field("elevation_loss_m", pa.float64()),
        pa.field("min_elevation_m", pa.float64()),
        pa.field("max_elevation_m", pa.float64()),
        pa.field("point_count", pa.int64(), False),
        pa.field("clean_point_count", pa.int64(), False),
        pa.field("dropped_jump_points", pa.int64(), False),
        pa.field("dropped_elevation_points", pa.int64(), False),
        pa.field("clean_distance_m", pa.float64()),
        pa.field("clean_elevation_gain_m", pa.float64()),
        pa.field("clean_elevation_loss_m", pa.float64()),
        pa.field("clean_min_elevation_m", pa.float64()),
        pa.field("clean_max_elevation_m", pa.float64()),
        pa.field("xmin", pa.float64(), False),
        pa.field("ymin", pa.float64(), False),
        pa.field("xmax", pa.float64(), False),
        pa.field("ymax", pa.float64(), False),
        pa.field("clean_xmin", pa.float64(), False),
        pa.field("clean_ymin", pa.float64(), False),
        pa.field("clean_xmax", pa.float64(), False),
        pa.field("clean_ymax", pa.float64(), False),
        pa.field("spatial_order", pa.int64(), False),
        pa.field("distance_source", pa.string(), False),
        pa.field("moving_time_source", pa.string(), False),
        pa.field("elevation_source", pa.string(), False),
    ]
    geo_metadata = {
        b"ARROW:extension:name": b"geoarrow.linestring",
        b"ARROW:extension:metadata": json.dumps({"crs": "OGC:CRS84"}).encode(),
    }
    geometry = [
        pa.field(name, line_type, False, metadata=geo_metadata) for name in GEOMETRY_COLUMNS
    ]
    return pa.schema([*scalar, *geometry, pa.field("track_points", pa.list_(point_type), False)])


def geo_metadata(bounds: list[float]) -> dict[bytes, bytes]:
    columns: dict[str, Any] = {}
    for name in GEOMETRY_COLUMNS:
        prefix = "clean_" if name.startswith("geometry_clean") else ""
        columns[name] = {
            "encoding": "linestring",
            "geometry_types": ["LineString"],
            "bbox": bounds,
            "covering": {
                "bbox": {
                    "xmin": [f"{prefix}xmin"],
                    "ymin": [f"{prefix}ymin"],
                    "xmax": [f"{prefix}xmax"],
                    "ymax": [f"{prefix}ymax"],
                }
            },
        }
    payload = {"version": "1.1.0", "primary_column": "geometry", "columns": columns}
    return {b"geo": json.dumps(payload, separators=(",", ":")).encode()}


def metadata_arrow_schema() -> pa.Schema:
    canonical = activity_arrow_schema()
    fields = [field for field in canonical if field.name not in {*GEOMETRY_COLUMNS, "track_points"}]
    return pa.schema([*fields, pa.field("activity_family", pa.string(), False)])


def render_arrow_schema() -> pa.Schema:
    canonical = activity_arrow_schema()
    names = [
        "activity_id",
        "xmin", "ymin", "xmax", "ymax",
        "clean_xmin", "clean_ymin", "clean_xmax", "clean_ymax",
    ]
    fields = [canonical.field(name) for name in names]
    geometry_metadata = {
        b"ARROW:extension:name": b"geoarrow.linestring",
        b"ARROW:extension:metadata": json.dumps({"crs": "OGC:CRS84"}).encode(),
    }
    return pa.schema([
        *fields,
        pa.field("spatial_order", pa.int64(), False),
        pa.field("vertex_count", pa.int64(), False),
        pa.field("clean_vertex_count", pa.int64(), False),
        pa.field("geometry", line_type, False, metadata=geometry_metadata),
        pa.field("geometry_clean", line_type, False, metadata=geometry_metadata),
    ])


def render_geo_metadata(bounds: list[float]) -> dict[bytes, bytes]:
    columns = {}
    for name, prefix in (("geometry", ""), ("geometry_clean", "clean_")):
        columns[name] = {
            "encoding": "linestring",
            "geometry_types": ["LineString"],
            "bbox": bounds,
            "covering": {
                "bbox": {
                    "xmin": [f"{prefix}xmin"],
                    "ymin": [f"{prefix}ymin"],
                    "xmax": [f"{prefix}xmax"],
                    "ymax": [f"{prefix}ymax"],
                }
            },
        }
    payload = {"version": "1.1.0", "primary_column": "geometry", "columns": columns}
    return {b"geo": json.dumps(payload, separators=(",", ":")).encode()}


def validate_render_table(
    table: Table[RenderActivitySchema],
) -> Table[RenderActivitySchema]:
    expected = render_arrow_schema()
    if table.schema.names != expected.names:
        raise ValueError("render table columns do not match the render schema")
    for expected_field, actual_field in zip(expected, table.schema, strict=True):
        if expected_field.type != actual_field.type:
            raise ValueError(
                f"invalid render Arrow type for {actual_field.name}: {actual_field.type}"
            )
    return RenderActivitySchema.validate(table)


def validate_arrow_table(table: Table[ActivitySchema]) -> Table[ActivitySchema]:
    expected = activity_arrow_schema()
    if table.schema.names != expected.names:
        raise ValueError("activity table columns do not match the canonical schema")
    for expected_field, actual_field in zip(expected, table.schema, strict=True):
        if expected_field.type != actual_field.type:
            raise ValueError(f"invalid Arrow type for {actual_field.name}: {actual_field.type}")
    return ActivitySchema.validate(table, lazy=True)
