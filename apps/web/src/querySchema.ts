export const QUERY_SCHEMA = `Squiggles DuckDB query contract (schema 1.3.0)

Return requirement:
- Every selection query must return an activity_id column.
- Query only the logical relation named activities.

activities columns:
activity_id VARCHAR NOT NULL
source_activity_id VARCHAR
source_filename VARCHAR NOT NULL
source_type VARCHAR NOT NULL -- fit, gpx, or tcx
source_checksum VARCHAR NOT NULL
schema_version VARCHAR NOT NULL
compiler_version VARCHAR NOT NULL
name VARCHAR NOT NULL
sport_type VARCHAR NOT NULL
start_time TIMESTAMPTZ
end_time TIMESTAMPTZ
start_year BIGINT NOT NULL -- Hive partition column
start_month BIGINT NOT NULL -- 1 through 12
activity_family VARCHAR NOT NULL -- run, ride, ski, foot, water, other; Hive partition column
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
geometry DOUBLE[2][] NOT NULL -- full CRS84 [longitude, latitude] LineString
geometry_lod0 DOUBLE[2][] NOT NULL -- about 40 vertices
geometry_lod1 DOUBLE[2][] NOT NULL -- about 100 vertices
geometry_lod2 DOUBLE[2][] NOT NULL -- about 400 vertices
geometry_lod3 DOUBLE[2][] NOT NULL -- about 2000 vertices
geometry_clean DOUBLE[2][] NOT NULL -- conservative cleaned full-resolution route
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
  clean BOOLEAN -- false only for a point excluded by conservative cleaning
)[] NOT NULL

Units: distance/elevation are meters, durations are seconds, timestamps are UTC.
Raw geometry, telemetry, and summaries remain canonical. When the Clean toggle is
enabled and the query is run, the logical activities relation projects the clean
geometry, bounds, summaries, point count, and filtered track_points into the normal
column names. This lets the same SQL run before or after conservative cleaning without
mutating the GeoParquet source. Clean reconnects the valid samples around an isolated
spike; it does not fabricate replacement telemetry values.

Example — runs containing any recorded point above 12,000 feet (3657.6 m):
SELECT activity_id
FROM activities
WHERE lower(sport_type) LIKE '%run%'
  AND EXISTS (
    SELECT 1
    FROM unnest(track_points) AS points(point)
    WHERE point.elevation_m >= 3657.6
  );`;
