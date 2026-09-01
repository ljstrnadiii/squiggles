# Architecture

## Principles

- GeoParquet is the canonical activity format.
- DuckDB SQL is the query interface.
- Browser rendering stays Arrow/GeoArrow-native.
- Hosted services manage identity, metadata, uploads, and publishing; they do not replace the browser query engine.
- Keep data access private by default.
- Prefer serverless/scale-to-zero infrastructure.

## Data flow

1. Source adapter reads an activity archive.
2. Compiler normalizes activities and telemetry.
3. Compiler writes:
   - canonical GeoParquet shards
   - render LOD files
   - spatial row-group metadata
   - `dataset.json`
   - rejection records
4. Browser loads the manifest.
5. DuckDB-Wasm registers remote/local Parquet files.
6. SQL selects `activity_id` values from `activities`.
7. Renderer chooses LOD from zoom + vertex budget.
8. Viewport bboxes prune files/row groups.
9. GeoArrow buffers transfer directly to deck.gl.
10. Viewport results are cached in browser memory.

## Browser components

- React UI.
- DuckDB-Wasm Web Worker for SQL, summaries, table data, detail lookup, and render planning.
- deck.gl/WebGL for routes.
- Browser-side heat computation.
- Local storage for user preferences and saved local tabs.

## LOD

- LOD0: ~40 vertices/activity.
- LOD1: ~100.
- LOD2: ~400.
- LOD3: ~2,000.
- LOD4: raw geometry.
- Zoom sets a fidelity ceiling.
- Resolution budget may downgrade further.

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

- Spatially ordered Parquet.
- Manifest file/row-group bboxes.
- Column pruning and HTTP range reads.
- Render pyramid for coarse views.
- Binary Arrow transfer instead of GeoJSON/object expansion.
- In-memory viewport cache and padded follow-up fetches.
