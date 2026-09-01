# Architecture

## Boundaries

- **Ingestion:** source adapter → normalized Arrow → GeoParquet.
- **Canonical data:** immutable activity GeoParquet.
- **Query:** DuckDB SQL over the logical `activities` relation.
- **Rendering:** GeoArrow buffers → deck.gl; MapLibre provides basemaps.
- **Control plane:** identity, ownership, saved views, publishing, upload state.
- **Infrastructure:** Pulumi-managed AWS resources.

## Ingestion

- Source adapters isolate archive-specific discovery and metadata normalization.
- Strava export is the currently supported adapter.
- FIT, GPX, and TCX normalize into one activity schema.
- Ray processes Arrow batches; Pandera validates table contracts.
- `GeoParquetDataSink` writes canonical shards directly.
- Raw activity data remains canonical; cleaning is stored as derived columns.

## Physical data layout

- Hive partition: `activity_family`.
- `start_year` and `start_month` remain scalar Parquet columns.
- Activities are spatially ordered by route-bbox Morton key.
- Manifest stores shard and row-group conservative bboxes.
- Canonical shards contain full data and LOD columns.
- Schema 1.4 adds render-only GeoParquet files for LOD0–LOD4.

## Browser execution

- Browser loads `dataset.json`.
- DuckDB-Wasm runs in a Web Worker.
- `activity_source` is private; user SQL targets `activities` only.
- Selection queries must return `activity_id`.
- Selection state is reused by viewport rendering, statistics, and table queries.
- Clean mode replaces the logical `activities` view with derived clean columns before SQL runs.

## Viewport rendering

- Manifest bboxes prune unrelated files.
- Row-group bboxes guide expected Parquet pruning.
- Exact activity bbox predicates run in DuckDB.
- Zoom sets the maximum LOD fidelity.
- Vertex budget may choose a coarser representation.
- LOD0–LOD3 are simplified; LOD4 is full geometry.
- GeoArrow coordinate buffers transfer directly to deck.gl.
- Routes are split at coordinate gaps over 20 km before drawing.

## Cache

- Cache key includes dataset revision, SQL selection, clean/raw state, LOD ceiling, and bounds.
- Cached viewport results own already-transferred typed arrays.
- Contained viewports can reuse an enclosing cached result.
- Follow-up viewport misses use padded bounds to improve reuse.
- Cache is memory-only and LRU-bounded.

## UI/query semantics

- Saved queries keep SQL, camera, and per-query rendering style.
- Switching queries executes the saved SQL.
- Editing SQL requires explicit Run.
- New queries inherit the live camera/style.
- Statistics and Table describe the full selection by default and can scope to the viewport.
- Activity detail fetches full geometry/telemetry on demand.
- Published views persist query tabs, active tab, camera, and rendering state.

## Heat

- Heat uses the already selected render geometry.
- Each route receives one score/color from nearby vertices belonging to other activities.
- Heat does not create a second geometry dataset.

## Hosted V1

- Static application and immutable dataset objects are delivered through CloudFront/S3.
- DuckDB and rendering remain client-side.
- Cognito handles identity.
- DynamoDB stores control-plane metadata only.
- Lambda/API Gateway handles account/upload/publish operations.
- AWS Batch/Fargate performs managed compilation with no idle worker.
- Private activity data is not stored in DynamoDB.

## Execution abstraction

- SQL semantics are stable across execution engines.
- `RenderPlan` separates query semantics from physical rendering delivery.
- Direct Arrow is current; MVT remains benchmark-gated.
