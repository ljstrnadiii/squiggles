# Project rules

- Build Squiggles as an activity-archive explorer, not a source-specific application.
- The currently supported source adapter is a Strava export; keep ingestion adapter-based for future archive formats.
- Canonical activity data is Parquet/GeoParquet. Do not introduce another authoritative database.
- DuckDB SQL is the query language. Do not add a query DSL.
- Preserve boundaries between ingestion, canonical data, query execution, rendering, and control-plane metadata.
- Browser and future hosted execution must preserve SQL semantics; `RenderPlan` may differ.
- Prefer Arrow/GeoArrow paths. Do not expand large datasets to GeoJSON or per-point JS objects.
- Real activity data is private. Never commit it; tests use synthetic fixtures.
- Authorization must happen before hosted data access. Hosted SQL is read-only and relation-restricted.
- Raw activity data stays canonical. Cleaning is derived and reversible.
- Ingestion uses Ray + PyArrow/Pandera and writes GeoParquet directly through the shared sink.
- Source archives are compiled locally or in managed ingestion; curated GeoParquet is the application data format.
- Pulumi owns persistent AWS resources. Prefer serverless/scale-to-zero services.
- Do not add NAT Gateway, RDS/Aurora, EKS, OpenSearch, ElastiCache, or always-on compute without an explicit decision.
- Keep development infrastructure below $50/month; document meaningful idle-cost changes.
- Measure performance changes before and after. Do not assume MVT beats direct Arrow rendering.
- Work in focused stages/PRs; run relevant tests, lint, and type checks before merging.
