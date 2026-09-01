# Squiggles

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/logo-dark.png" />
  <img src="apps/web/public/logo-light.png" alt="Squiggles logo" width="180" />
</picture>

Squiggles is a local-first activity-archive explorer built on GeoParquet, DuckDB-Wasm, GeoArrow, deck.gl, and MapLibre.

## What it does

- Explore years of recorded activities on one map.
- Query activities with ordinary DuckDB SQL.
- Save multiple query/map views.
- Inspect statistics, sortable activity metadata, full route detail, and elevation profiles.
- Render large archives with viewport pruning, spatially ordered Parquet, adaptive LODs, binary GeoArrow, and an in-memory viewport cache.
- Keep query execution and rendering in the browser.
- Publish selected views through short `/p/<slug>` links.

Squiggles is not a route planner, navigation tool, coaching platform, or social feed.

## Supported archive input

- The ingestion layer is adapter-based.
- **Currently supported archive export:** Strava.
- Supported activity files inside that export: FIT, GPX, TCX, including gzip variants.
- Raw source archives are not application data; compilation produces the canonical GeoParquet dataset.

Compile and validate:

```bash
uv run squiggles compile-strava /path/to/export --output data/local/archive
uv run squiggles validate data/local/archive
```

## Local development

Requirements:

- Python 3.12 or 3.13
- `uv`
- Node.js 22+
- `pnpm` 11.22

Run:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Then choose **Dataset** and open a compiled dataset directory.

## Query model

- Selection SQL queries only the logical `activities` relation.
- Every selection query returns `activity_id`.
- SQL units are meters and seconds; display units are independent.
- **Clean** swaps in precompiled derived clean geometry/metrics without mutating canonical data.
- **AI Skills** copies the query contract for use with an external SQL assistant.

See [docs/query-schema.md](docs/query-schema.md).

## Rendering model

- Browser reads `dataset.json` and registers Parquet with DuckDB-Wasm in a Web Worker.
- Manifest shard/row-group bounds prune unrelated data before exact bbox filtering.
- Five render levels are available: four simplified LODs plus full geometry.
- Zoom is a fidelity ceiling; the system vertex budget may choose a coarser LOD.
- Default vertex budgets: Low 250k, Medium 750k, High 1.25M.
- GeoArrow coordinate buffers transfer directly to deck.gl without GeoJSON conversion.
- Viewport results are cached in memory and nearby viewport misses are fetched with padding for reuse.
- Full activity geometry and telemetry load only when detail is requested.

## Hosted design

- Static Vite app and immutable dataset files are served through CloudFront/S3.
- DuckDB queries and map rendering still run client-side.
- Cognito handles identity; DynamoDB stores control-plane metadata only.
- AWS Batch/Fargate runs managed archive compilation with no idle worker.
- Pulumi owns persistent AWS resources.
- Development infrastructure is capped at $50/month by project policy.

Production: `https://squiggles.io`

## Verify

```bash
uv run ruff check .
uv run mypy
uv run pytest
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

## Design docs

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Authentication](docs/auth.md)
- [Security](docs/security.md)
- [Query schema](docs/query-schema.md)
- [Benchmarks](docs/benchmarks.md)
- [Architecture decisions](docs/decisions.md)
- [AWS runbook](infra/aws/README.md)
