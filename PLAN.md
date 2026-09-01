# Squiggles roadmap

## Product

- Activity-archive exploration and storytelling.
- DuckDB SQL for selection.
- Browser-first query/rendering path.
- Stable published views with saved camera/query/style state.
- Adapter-based ingestion; Strava export is the currently supported archive format.

## Current architecture

- Canonical data: GeoParquet.
- Query engine: DuckDB-Wasm in a Web Worker.
- Rendering: GeoArrow → deck.gl; MapLibre basemap underneath.
- Physical layout: activity-family Hive partitioning, spatial ordering, shard/row-group bbox metadata.
- Render pyramid: LOD0–LOD3 plus full geometry.
- Hosted delivery: private S3 origins behind CloudFront.
- Identity/control plane: Cognito + DynamoDB + Lambda/API Gateway.
- Managed ingestion: AWS Batch/Fargate using the same compiler as local ingestion.
- Infrastructure: Pulumi.

## Done

- Local archive compilation and validation.
- FIT/GPX/TCX normalization.
- Raw and reversible clean representations.
- Spatially ordered canonical shards and render pyramid.
- DuckDB SQL tabs, statistics, table, route detail, elevation profile.
- Adaptive LOD planning and viewport pruning.
- Direct GeoArrow binary rendering.
- Route heat/proximity coloring.
- Viewport result cache and padded follow-up fetches.
- Local and hosted datasets.
- Google/Cognito sign-in and approval gate.
- Managed upload/ingestion pipeline.
- Stable published `/p/<slug>` views.
- CI, GitHub OIDC deployment, semantic releases.

## Near-term

- Reduce first-paint latency.
  - Measure manifest, DuckDB initialization, selection, summary, and render stages.
  - Fast-path universal activity selections.
  - Avoid unnecessary selection-ID transfer.
  - Evaluate deferring global summary work until after first paint.
- Keep published-view startup correct at any camera/zoom.
- Improve panel/layout polish across desktop and mobile.
- Continue benchmark-driven Parquet/LOD tuning.

## Later, only if benchmarks justify it

- Tile/chunk-level geometry cache instead of viewport-result cache.
- Persistent browser cache.
- Additional source adapters.
- Alternate hosted execution engine.
- MVT rendering for density tiers where direct Arrow is measurably worse.
- 3D terrain.

## Constraints

- No second authoritative activity database.
- No GeoJSON expansion for large rendering paths.
- No always-on AWS compute without an explicit decision.
- Development infrastructure stays below $50/month.
- Performance architecture changes require before/after measurement.
