# Architecture decisions

## Accepted

- **Canonical data:** GeoParquet, not a database service.
- **Query language:** DuckDB SQL.
- **Browser engine:** DuckDB-Wasm in a Web Worker.
- **Rendering:** Arrow/GeoArrow buffers into deck.gl/WebGL.
- **Large-data rule:** avoid GeoJSON/object expansion.
- **Spatial layout:** STR-packed render row groups + manifest/file/row-group bboxes.
- **Rendering scale:** fixed-tolerance LOD pyramid + runtime vertex budget.
- **Render storage:** one logical render dataset with `lod` as the first physical partition; no family/year Hive fan-out.
- **Geometry identity:** render activities remain whole and are never clipped to spatial tile boundaries.
- **LOD semantics:** zoom/pixel scale selects the fidelity ceiling; Low/Medium/High change only the vertex budget.
- **Budget fallback:** dense viewports may move to a coarser LOD to stay interactive.
- **Viewport reads:** bbox pruning happens from manifest metadata before geometry reads where possible.
- **Published startup:** persist the resolved starting LOD and vertex estimate as a one-time startup hint.
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

- PMTiles as a parallel rendering datastore.
- Spatially clipping activities into tile fragments.
- Render-file fan-out by `activity_family/start_year`.
- PostGIS/RDS/Aurora as canonical storage.
- NAT Gateway for the development architecture.
- EKS or always-on application compute.
- OpenSearch/ElastiCache for current needs.
- Server-side map rendering for normal interaction.
- Provider-specific schema as the canonical model.
- Raw activity archive uploads when compiled GeoParquet can be uploaded instead.

## Performance decisions

- The render pyramid uses roughly one fixed-tolerance level per two zoom levels.
- Row groups target about 4 MiB of uncompressed Arrow data as an initial mobile-oriented tuning value.
- Render files target about 1 GiB uncompressed Arrow data so an LOD normally remains one file with many row groups.
- STR is the primary render ordering strategy because the dominant access pattern is a rectangular viewport over all activities.
- STR stripe count is adjusted for Web Mercator extent aspect ratio to favor compact, approximately square row-group bboxes.
- `activity_family`, `start_year`, then `activity_id` are secondary ordering keys inside each STR group rather than physical partition keys.
- Compiler metadata stores bbox and vertex-count aggregates so universal selections can fall back through LODs without exploratory Parquet requests.
- Direct Arrow rendering remains the default; alternate render stacks require benchmark evidence.
- Performance changes should be evaluated with startup/render diagnostics and consistent dataset/query/camera inputs.

## Security decisions

- Activity coordinates are private data.
- Authorization happens before private data access.
- Hosted SQL is read-only and relation-limited.
- AI/MCP use normal application interfaces.
- Persistent AWS resources remain Pulumi-owned.
