# Architecture decisions

## Accepted

- **Canonical data:** GeoParquet, not a database service.
- **Query language:** DuckDB SQL.
- **Browser engine:** DuckDB-Wasm in a Web Worker.
- **Rendering:** Arrow/GeoArrow buffers into deck.gl/WebGL.
- **Large-data rule:** avoid GeoJSON/object expansion.
- **Spatial layout:** spatially ordered rows + row-group bboxes.
- **Rendering scale:** precompiled LOD pyramid + runtime vertex budget.
- **Viewport reads:** bbox pruning at manifest, Parquet, and SQL layers.
- **Caching:** in-memory viewport geometry cache with bounded memory.
- **Hosted delivery:** private S3 origins behind CloudFront.
- **Identity:** Cognito.
- **Control plane:** API Gateway + Lambda + DynamoDB metadata.
- **Managed compilation:** AWS Batch/Fargate.
- **Infrastructure:** Pulumi.
- **Deployment:** GitHub Actions OIDC; no stored AWS access keys.
- **Cost:** target under $50/month during development.
- **Source ingestion:** adapter pattern around a provider-agnostic activity archive model.
- **Current source support:** Strava exports; additional archive adapters may follow.

## Explicitly avoided

- PostGIS/RDS/Aurora as canonical storage.
- NAT Gateway for the development architecture.
- EKS or always-on application compute.
- OpenSearch/ElastiCache for current needs.
- Server-side map rendering for normal interaction.
- Provider-specific schema as the canonical model.
- Raw activity archive uploads when compiled GeoParquet can be uploaded instead.

## Performance decisions

- Zoom is a maximum fidelity, not a guarantee of detail.
- Resolution budgets may select a coarser LOD.
- Direct Arrow rendering remains the default until benchmarks justify another `RenderPlan`.
- Performance changes should be evaluated with startup/render diagnostics and consistent dataset/query/camera inputs.

## Security decisions

- Activity coordinates are private data.
- Authorization happens before private data access.
- Hosted SQL is read-only and relation-limited.
- AI/MCP use normal application interfaces.
- Persistent AWS resources remain Pulumi-owned.
