# Data model

## Canonical dataset

- Format: GeoParquet.
- One row per activity.
- Logical browser relation: `activities`.
- Canonical units: metres and seconds.
- Activity IDs are stable within a compiled dataset.

Core fields include:

- identifiers and source metadata
- activity name and sport type
- start/end time
- distance and duration
- elevation summary
- point counts and cleaning counters
- route geometry
- simplified LOD geometries
- route bbox
- track-point telemetry

## Clean view

Compiled datasets may include cleaned equivalents for:

- geometry
- distance/elevation summaries
- point count
- bbox
- track-point filtering

Clean mode projects those values into the normal logical `activities` columns. Canonical files are not rewritten in the browser.

## Storage layout

- Canonical shards are Hive-partitioned by `activity_family`.
- Rows are spatially ordered within partitions.
- Parquet row groups record conservative route bboxes.
- `start_year` and `start_month` remain queryable columns.

## Render pyramid

Each dataset contains render levels for:

- LOD0: ~40 vertices/activity
- LOD1: ~100
- LOD2: ~400
- LOD3: ~2,000
- LOD4: raw

Render files carry lightweight route metadata, bbox information, and geometry for direct viewport rendering.

## Manifest

`dataset.json` includes:

- schema version
- activity/rejection counts
- dataset bbox
- canonical shard metadata
- render-level metadata
- file sizes
- row counts
- row-group bboxes
- vertex statistics where available

## Source adapters

The normalized model is independent of source provider.

- Current adapter: Strava export archive.
- Supported activity file types today: FIT, GPX, TCX, including gzip variants.
- Future adapters should emit the same canonical schema.
