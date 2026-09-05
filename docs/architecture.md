# Architecture

## Principles

- GeoParquet is the canonical activity format.
- DuckDB SQL is the query interface.
- Browser rendering stays Arrow/GeoArrow-native.
- PMTiles are intentionally not part of the rendering architecture.
- Activities remain whole features; render geometry is never clipped to spatial tile boundaries.
- Hosted services manage identity, metadata, uploads, and publishing; they do not replace the browser query engine.
- Keep data access private by default.
- Prefer serverless/scale-to-zero infrastructure.

## Data flow

1. Source adapter reads an activity archive.
2. Compiler normalizes activities and telemetry.
3. Compiler writes:
   - canonical GeoParquet shards
   - a derived fixed-tolerance render LOD pyramid
   - spatial and vertex-count row-group metadata
   - `dataset.json`
   - rejection records
4. Browser loads the manifest.
5. DuckDB-Wasm registers remote/local Parquet files.
6. SQL selects `activity_id` values from `activities`.
7. Camera scale selects the approximately subpixel render LOD.
8. Manifest bboxes and vertex sums estimate the current viewport before geometry I/O.
9. If the estimate exceeds the device vertex budget, rendering moves to a coarser LOD until under budget or at LOD 0.
10. Viewport bboxes prune irrelevant physical data without clipping activity geometry.
11. GeoArrow buffers transfer directly to deck.gl.
12. Viewport results are cached in browser memory.

## Browser components

- React UI.
- DuckDB-Wasm Web Worker for SQL, summaries, table data, detail lookup, and render planning.
- deck.gl/WebGL for routes.
- Browser-side heat computation.
- Local storage for user preferences and saved local tabs.
- Unified Diagnostics surface for startup, network, LOD, query, cache, and device metrics; five taps on the Squiggles logo opens it on mobile.

## Render LOD pyramid

Render pyramid version 3 has eight physical LODs, roughly one for every two Web Mercator zoom levels:

| LOD | Tolerance |
| ---: | ---: |
| 0 | 2048 m |
| 1 | 512 m |
| 2 | 128 m |
| 3 | 32 m |
| 4 | 8 m |
| 5 | 2 m |
| 6 | 0.5 m |
| 7 | full geometry |

LOD is a physical storage boundary; row groups never mix simplification levels. Each render row records `vertex_count` and `clean_vertex_count`. The manifest records covering bboxes and sum/min/max counts per row group so the browser can choose a plan without probing multiple Parquet levels.

Low, Medium, and High are vertex budgets rather than alternate tolerance semantics: 750k, 1.25M, and 1.75M vertices respectively. The camera establishes the preferred subpixel LOD. In dense hotspots, budget wins and the renderer may intentionally use a coarser level to preserve responsiveness.

## Physical render layout

Whole activities are spatially ordered and grouped into approximately 4 MiB uncompressed Arrow-sized row groups before Parquet compression. The number is an initial mobile-oriented tuning target, not an immutable format contract. Coarse LODs that fit below it naturally become one row group; larger or finer levels create additional row groups while keeping the same simplification tolerance.

The 4 MiB target is intentionally small enough to avoid a single large cold-start transfer on mobile while still large enough to avoid returning to hundreds of tiny range reads. Diagnostics and real-device benchmarks should determine whether it moves later.

Spatial bounds describe the contents of each row group; they do not define geometry boundaries. A route may extend well outside the viewport and is still returned as one complete activity.

Canonical analytical data continues to use the existing `activity_family` / `start_year` pruning strategy. Render storage is optimized independently for visualization request count and viewport pruning.

## Published views

Published tabs may persist the resolved starting LOD and vertex estimate alongside camera/query state. The saved LOD is a startup hint rather than a permanent lock: reopening the link can start directly from that plan and move coarser immediately if the current device budget requires it. Normal adaptive LOD selection resumes when the camera or query changes.

## Hosted components

- CloudFront: application + dataset delivery.
- S3: web assets, uploaded inputs, compiled datasets.
- Cognito: identity.
- API Gateway + Lambda: control plane.
- DynamoDB: ownership, approval, dataset, and saved-view metadata.
- AWS Batch/Fargate: managed compilation.
- Pulumi: infrastructure ownership.
- GitHub Actions OIDC: deployment.

## Boundaries

- Canonical activity data does not live in DynamoDB.
- User SQL does not access arbitrary files, URLs, credentials, or extensions.
- Published views reference an explicitly published dataset and saved map/query state.
- MCP/AI use normal application contracts.

## Scale strategy

- Fixed-tolerance LOD pyramid with one physical resolution per row group.
- Spatially ordered Parquet.
- Small mobile-oriented render row groups.
- Manifest file/row-group bboxes and vertex sums.
- Column pruning and HTTP range reads.
- Budget-driven coarser-LOD fallback for dense repeated-route hotspots.
- Binary Arrow transfer instead of GeoJSON/object expansion.
- In-memory viewport cache and padded follow-up fetches.
