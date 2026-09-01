# Query schema

Squiggles uses ordinary DuckDB SQL.

## Selection contract

- Query only the logical relation `activities`.
- Return an `activity_id` column.
- Extra projected columns are allowed.
- `activity_id` determines which routes are rendered.
- A trailing semicolon is unnecessary but accepted.
- Canonical units are metres and seconds.

Example:

```sql
SELECT activity_id
FROM activities
WHERE distance_m >= 20000
ORDER BY start_time DESC
```

## Common columns

### Identity/source

- `activity_id`
- `source_activity_id`
- `source_filename`
- `source_type`
- `source_url`
- `name`
- `sport_type`
- `activity_family`

### Time

- `start_time`
- `end_time`
- `start_year`
- `start_month`
- `elapsed_seconds`
- `moving_seconds`

### Distance/elevation

- `distance_m`
- `elevation_gain_m`
- `elevation_loss_m`
- `min_elevation_m`
- `max_elevation_m`

### Geometry/quality

- `geometry`
- simplified LOD geometry columns
- `xmin`, `ymin`, `xmax`, `ymax`
- `point_count`
- `clean_point_count`
- `dropped_jump_points`
- `dropped_elevation_points`
- `track_points`

## Clean mode

When enabled and supported by the dataset schema, clean geometry/summary/bbox values are projected into the normal logical columns before SQL runs.

## Nested telemetry example

```sql
SELECT activity_id
FROM activities
WHERE EXISTS (
  SELECT 1
  FROM unnest(track_points) AS points(point)
  WHERE point.elevation_m >= 3657.6
)
```

The in-app **AI Skills** panel contains the exact schema contract for the current build.
