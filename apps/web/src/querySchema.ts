export const QUERY_SCHEMA = `Squiggles DuckDB query contract (schema 1.5.0)

Query rules:
- Return a SELECT query whose result includes activity_id.
- Query only the logical relation named activities.
- A trailing semicolon is unnecessary; Squiggles normalizes one if present.
- The query acts as a selection relation. Additional returned columns are allowed, but Squiggles ultimately uses activity_id to determine which activities are rendered and summarized.

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
start_year BIGINT NOT NULL
start_month BIGINT NOT NULL -- 1 through 12
activity_family VARCHAR NOT NULL -- run, ride, ski, foot, water, other
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

Units: distance/elevation are meters, durations are seconds, timestamps are UTC.
The activities relation is the lightweight metadata/index dataset. Full geometry and
track-point telemetry remain in canonical detail Parquet and are not exposed to user
selection SQL. Render overview geometry is stored separately by LOD. When the Clean
toggle is enabled, the logical activities relation projects clean scalar summaries,
point count, and bounds into the normal column names so the same SQL can be reused.

Example — runs whose recorded maximum elevation is at least 12,000 feet (3657.6 m):
SELECT activity_id
FROM activities
WHERE lower(sport_type) LIKE '%run%'
  AND max_elevation_m >= 3657.6`;
