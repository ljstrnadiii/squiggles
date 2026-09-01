# Data model

## Core objects

- `Dataset`
- `Activity`
- `QueryTab`
- `QueryResult`
- `SummaryStats`
- `RenderPlan`
- `Share`

## Canonical activity relation

One row per spatial activity.

Key groups:

- Identity/provenance: `activity_id`, source metadata, schema/compiler versions.
- Time: UTC start/end timestamps, year, month.
- Classification: `sport_type`, `activity_family`.
- Summaries: distance, moving/elapsed time, elevation metrics, point counts.
- Bounds: raw and clean `xmin/ymin/xmax/ymax`.
- Geometry: full LineString plus LOD0–LOD3.
- Clean geometry: derived full route plus clean LOD0–LOD3.
- Telemetry: nested ordered track points.
- Spatial ordering: deterministic bbox-center Morton key.

Canonical units:

- Distance/elevation: meters.
- Duration: seconds.
- Coordinates: CRS84 longitude/latitude.
- Timestamps: UTC.

## Cleaning

- Raw samples are never rewritten.
- Clean columns are derived at compile time.
- GPS/elevation removal requires conservative isolated-spike evidence.
- Per-activity drop counts remain available for diagnostics.
- Clean mode projects derived fields onto the normal logical column names before user SQL runs.

## Physical layout

- Hive partitioned by `activity_family`: `run`, `ride`, `ski`, `foot`, `water`, `other`.
- Activities are spatially ordered across years.
- Canonical files use configurable shard and row-group sizes.
- `dataset.json` records file checksums, counts, bboxes, row-group bboxes, and render-level metadata.

## Render pyramid

Schema 1.4 adds five derived render files:

- LOD0: ≤40 vertices/activity.
- LOD1: ≤100.
- LOD2: ≤400.
- LOD3: ≤2000.
- LOD4: full geometry.

Each render level contains only fields needed for rendering/picking plus raw/clean geometry for that level. Render files are derived and replaceable; canonical activity files remain authoritative.

## Source adapters

- Ingestion is source-adapter based.
- Strava export is the currently supported archive format.
- Supported activity files are FIT, GPX, and TCX.
- FIT messages sharing a timestamp are merged into one logical sample; enhanced altitude is preferred when present.

See [query-schema.md](query-schema.md) for the DuckDB-facing column contract.
