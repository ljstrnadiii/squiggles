# Project implementation rules

1. Work one stage at a time. Do not implement later-stage infrastructure early.
2. Preserve the distinction between canonical data, query execution, rendering, and control-plane metadata.
3. DuckDB SQL is the query language. Do not invent a query DSL.
4. Browser and hosted execution must share SQL semantics but may return different RenderPlans.
5. The canonical activity dataset is Parquet/GeoParquet. Do not introduce PostGIS or another authoritative database.
6. Never convert large geospatial datasets to GeoJSON merely as an intermediate representation unless required for a small compatibility path.
7. Prefer Arrow/GeoArrow-compatible interfaces.
8. Never commit real user activity data. Tests use synthetic fixtures.
9. Treat activity locations as private data. Authorization decisions always happen before data access.
10. Hosted SQL is read-only and validated. User SQL cannot access arbitrary files, URLs, extensions, credentials, or relations.
11. Do not create AWS infrastructure until the local browser and native-server stages pass their acceptance tests.
12. AWS infrastructure must remain serverless/scale-to-zero where practical.
13. Do not provision NAT Gateway, RDS, Aurora, EKS, OpenSearch, ElastiCache, or always-on EC2/ECS without an explicit architecture decision record.
14. Pulumi owns all persistent AWS resources.
15. Maintain a $50/month development budget. Infrastructure changes that can create meaningful idle cost require a note in docs/decisions.md.
16. Every performance optimization needs a benchmark before and after.
17. Do not assume MVT is always faster than direct Arrow rendering. Use the RenderPlan abstraction and measured thresholds.
18. Keep ingestion implementation shared between local and cloud workflows.
19. MCP and AI are adapters over the normal application API. They do not get privileged database access.
20. At the end of each stage, run tests and type checking, update docs and applicable benchmarks, list unresolved issues, and do not silently begin the next stage.
21. Let's use a geoparquet sink to directly write out to geoparquet with ray, all returns types of pyarrow\.Table should be a pandera schema, too.
22. Let's use an adapter pattern where strava is one of many possible implementations of a source leaving room for less of a refactor later on.
23. We should make sure that a user does not upload the entire .zip archive since there is a lot of extra data and privacy concerns. A user will git clone or pypi install to build their archive then upload the parquet directly with another helper/script.