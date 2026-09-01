# Architecture decisions

Current accepted decisions only. Historical benchmark detail belongs in [benchmarks.md](benchmarks.md).

## Product

- Squiggles is an activity-archive explorer and storytelling tool.
- It is not a route planner, navigation product, coaching platform, or social feed.
- Ingestion is source-adapter based; Strava export is the currently supported archive format.

## Canonical data

- GeoParquet is authoritative.
- One canonical activity row contains metadata, summaries, bounds, geometry, LODs, and nested telemetry.
- Raw samples are immutable.
- Clean fields are derived, conservative, and reversible.
- `activity_family` is the only Hive partition key; time remains scalar columns.
- Physical order is spatial Morton order across years.

## Query execution

- DuckDB SQL is the user query language.
- User SQL targets only `activities` and returns `activity_id`.
- Browser execution uses DuckDB-Wasm in a Web Worker.
- Selection semantics are separate from rendering delivery.
- A universal selection may be optimized internally without changing SQL semantics.
- Hosted execution is optional later and must preserve the same SQL contract.

## Rendering

- Direct Arrow/GeoArrow is the default render path.
- No large GeoJSON intermediate representation.
- LOD0–LOD3 plus full geometry form the render pyramid.
- Zoom is a fidelity ceiling; vertex budget can downgrade dense views.
- Manifest file/row-group bboxes and exact DuckDB bbox predicates prune viewport reads.
- Full activity geometry/telemetry loads on demand.
- MVT remains benchmark-gated.

## Cache

- Cache already-transferred binary viewport results in memory.
- Reuse enclosing cached viewports when possible.
- Use padded follow-up viewport fetches to improve small-pan reuse.
- Persistent/tile-level caching requires measurement before adoption.

## Heat

- Heat colors the existing selected route geometry.
- Scores use nearby vertices from other activities.
- No separate global heat cloud or duplicate geometry layer.

## UI

- Saved queries own SQL, camera, and per-query rendering style.
- New queries inherit the live camera/style.
- Switching a saved query executes it.
- SQL drafts apply only through Run.
- Statistics and Table are secondary inspection views; Activity Detail keeps its dedicated compact layout.
- Published views preserve their saved camera exactly.

## Hosted V1

- Client-first query/rendering remains the primary data path.
- CloudFront + private S3 deliver the static app and GeoParquet ranges.
- Cognito handles identity.
- DynamoDB stores control-plane metadata only.
- Lambda/API Gateway handles control-plane actions.
- AWS Batch/Fargate performs managed compilation.
- No always-on query server is required.

## Security

- Activity locations are private data.
- Authorization occurs before hosted data access.
- Browser receives no AWS credentials.
- GitHub deploys through OIDC.
- Local operators use IAM Identity Center temporary credentials.
- Published slugs are locators, not secrets.

## Infrastructure

- Pulumi owns persistent AWS resources except documented bootstrap prerequisites.
- Prefer serverless/scale-to-zero services.
- No NAT Gateway, RDS/Aurora, EKS, OpenSearch, ElastiCache, or always-on compute without a new decision.
- Development infrastructure target: under $50/month.
- AWS Budget alerts are monitoring, not a hard cap.

## Engineering

- Ray + Arrow/Pandera drive ingestion.
- Canonical publication stays Arrow-native.
- Performance changes require before/after measurement.
- Conventional Commit squash titles drive semantic releases.
