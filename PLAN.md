# Squiggles roadmap

## Product

- Explore a large personal activity archive on a map.
- Query activities with DuckDB SQL.
- Save map/query tabs and publish selected views.
- Keep local exploration useful without a server.
- Keep hosted sharing simple and inexpensive.

## Data

- Canonical format: GeoParquet.
- Current input adapter: Strava export archives containing FIT, GPX, and TCX activities.
- Future adapters may support other activity archive formats.
- Compiler outputs:
  - canonical activity shards
  - spatial row-group metadata
  - render LOD pyramid
  - `dataset.json` manifest
  - rejection records
- Spatial ordering and row-group bboxes support pruning.

## Browser execution

- DuckDB-Wasm runs SQL in a Web Worker.
- Query contract returns `activity_id` from logical relation `activities`.
- Rendering uses Arrow/GeoArrow buffers directly with deck.gl.
- Viewport bbox pruning limits Parquet reads.
- LOD is constrained by zoom and vertex budget.
- Transferred viewport geometry is cached in memory.
- Heat rendering is derived in-browser from selected geometry.

## Hosted system

- Static web app: S3 + CloudFront.
- Published/managed datasets: private S3 behind CloudFront.
- Auth: Cognito, including Google federation when configured.
- Metadata/control plane: DynamoDB + Lambda + API Gateway.
- Ingest jobs: AWS Batch/Fargate.
- Infrastructure: Pulumi.
- Deployment: GitHub Actions OIDC.
- Development budget target: under $50/month.

## Near-term work

- Reduce first-paint latency for published views.
- Improve query diagnostics and performance instrumentation.
- Keep table/stats/query panels compact and responsive.
- Expand archive adapters without coupling the data model to one provider.
- Harden managed uploads, approval, ownership, and publishing workflows.

## Non-goals

- Social feed.
- Route planning/navigation.
- Training/coaching platform.
- Authoritative relational geospatial database.
- Always-on backend compute for normal map interaction.
