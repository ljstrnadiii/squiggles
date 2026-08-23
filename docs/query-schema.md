# DuckDB query schema for AI assistants

Give this contract to a natural-language SQL assistant when asking it to generate an Activity Map query. The same text is available from **AI Skills → Copy for your AI** in the application.

Every selection query must return an `activity_id` column and query only the logical `activities` relation. Distances and elevations use meters, durations use seconds, coordinates are CRS84 longitude/latitude, and timestamps are UTC.

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
  start_year BIGINT NOT NULL                   -- scalar column with Parquet statistics
  start_month BIGINT NOT NULL                  -- 1 through 12
  activity_family VARCHAR NOT NULL             -- Hive partition: run, ride, ski, foot, water, other
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
  geometry DOUBLE[2][] NOT NULL                -- full LineString
  geometry_lod0 DOUBLE[2][] NOT NULL           -- at most 40 vertices
  geometry_lod1 DOUBLE[2][] NOT NULL           -- at most 100 vertices
  geometry_lod2 DOUBLE[2][] NOT NULL           -- at most 400 vertices
  geometry_lod3 DOUBLE[2][] NOT NULL           -- at most 2000 vertices
  geometry_clean DOUBLE[2][] NOT NULL          -- conservative cleaned full route
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
    clean BOOLEAN                              -- retained by conservative cleaner
  )[] NOT NULL
```

Raw geometry, telemetry, and summaries remain canonical. The `clean_*` columns are derived alternatives. When Clean is enabled and the query is run, the worker projects clean geometry, bounds, summaries, point count, and filtered `track_points` into the normal column names before executing the unchanged user SQL. This reversible view reconnects valid neighbors around an isolated excluded sample, but it does not rewrite GeoParquet or fabricate replacement telemetry.

Example: runs containing any recorded point above 12,000 feet (3,657.6 meters):

```sql
SELECT activity_id
FROM activities
WHERE lower(sport_type) LIKE '%run%'
  AND EXISTS (
    SELECT 1
    FROM unnest(track_points) AS points(point)
    WHERE point.elevation_m >= 3657.6
  );
```
