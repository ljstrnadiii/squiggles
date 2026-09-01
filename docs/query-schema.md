# DuckDB query schema

Use this contract with an AI/SQL assistant.

## Query rules

- Query only the logical relation `activities`.
- Return an `activity_id` column.
- Additional columns are allowed but rendering selection is driven by `activity_id`.
- A trailing semicolon is unnecessary.
- Distances/elevations are meters.
- Durations are seconds.
- Coordinates are CRS84 longitude/latitude.
- Timestamps are UTC.

## Relation

```text
activities
  activity_id VARCHAR NOT NULL
  source_activity_id VARCHAR
  source_filename VARCHAR NOT NULL
  source_type VARCHAR NOT NULL                 -- fit, gpx, tcx
  source_checksum VARCHAR NOT NULL
  schema_version VARCHAR NOT NULL
  compiler_version VARCHAR NOT NULL
  name VARCHAR NOT NULL
  sport_type VARCHAR NOT NULL
  start_time TIMESTAMPTZ
  end_time TIMESTAMPTZ
  start_year BIGINT NOT NULL
  start_month BIGINT NOT NULL                  -- 1..12
  activity_family VARCHAR NOT NULL             -- run, ride, ski, foot, water, other
  original_start_time VARCHAR
  source_url VARCHAR
  distance_m DOUBLE
  elapsed_seconds DOUBLE
  moving_seconds DOUBLE
  elevation_gain_m DOUBLE
  elevation_loss_m DOUBLE
  min_elevation_m DOUBLE
  max_elevation_m DOUBLE
  point_count BIGINT NOT NULL
  clean_point_count BIGINT NOT NULL
  dropped_jump_points BIGINT NOT NULL
  dropped_elevation_points BIGINT NOT NULL
  clean_distance_m DOUBLE
  clean_elevation_gain_m DOUBLE
  clean_elevation_loss_m DOUBLE
  clean_min_elevation_m DOUBLE
  clean_max_elevation_m DOUBLE
  xmin DOUBLE NOT NULL
  ymin DOUBLE NOT NULL
  xmax DOUBLE NOT NULL
  ymax DOUBLE NOT NULL
  clean_xmin DOUBLE NOT NULL
  clean_ymin DOUBLE NOT NULL
  clean_xmax DOUBLE NOT NULL
  clean_ymax DOUBLE NOT NULL
  spatial_order BIGINT NOT NULL
  distance_source VARCHAR NOT NULL
  moving_time_source VARCHAR NOT NULL
  elevation_source VARCHAR NOT NULL
  geometry DOUBLE[2][] NOT NULL
  geometry_lod0 DOUBLE[2][] NOT NULL           -- <= 40 vertices
  geometry_lod1 DOUBLE[2][] NOT NULL           -- <= 100
  geometry_lod2 DOUBLE[2][] NOT NULL           -- <= 400
  geometry_lod3 DOUBLE[2][] NOT NULL           -- <= 2000
  geometry_clean DOUBLE[2][] NOT NULL
  geometry_clean_lod0 DOUBLE[2][] NOT NULL
  geometry_clean_lod1 DOUBLE[2][] NOT NULL
  geometry_clean_lod2 DOUBLE[2][] NOT NULL
  geometry_clean_lod3 DOUBLE[2][] NOT NULL
  track_points STRUCT(
    sequence INTEGER,
    timestamp TIMESTAMPTZ,
    longitude DOUBLE,
    latitude DOUBLE,
    elevation_m DOUBLE,
    heart_rate DOUBLE,
    cadence DOUBLE,
    power DOUBLE,
    clean BOOLEAN
  )[] NOT NULL
```

## Clean mode

- Raw fields remain canonical.
- Clean mode projects derived clean geometry, bounds, metrics, point count, and filtered telemetry onto the normal logical names before the same SQL executes.
- GeoParquet is not rewritten.

## Example

Activities containing any recorded point above 3,657.6 m:

```sql
SELECT activity_id
FROM activities
WHERE EXISTS (
  SELECT 1
  FROM unnest(track_points) AS points(point)
  WHERE point.elevation_m >= 3657.6
)
```
