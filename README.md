# Squiggles

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/logo-dark.png" />
  <img src="apps/web/public/logo-light.png" alt="Squiggles logo" width="180" />
</picture>

A local-first explorer for large personal activity archives.

- Compile an archive to GeoParquet.
- Query activities with DuckDB SQL.
- Explore routes with viewport-aware LOD rendering.
- Save and publish selected map views.
- Keep canonical activity data columnar and portable.

The current importer supports Strava exports containing FIT, GPX, and TCX activities. The archive model is provider-agnostic and intended to support additional sources later.

## Requirements

- Python 3.12 or 3.13 + `uv`
- Node.js 22+ + `pnpm` 11.22
- Chrome or Edge for local directory access

## Compile an archive

```bash
uv run squiggles compile-strava /path/to/export --output data/local/archive
uv run squiggles validate data/local/archive
```

Output includes canonical GeoParquet shards, a spatial render pyramid, `dataset.json`, and rejection records.

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Then open the app and select the compiled dataset directory.

Development datasets under `data/local/` can also be opened through Vite:

```text
http://localhost:5173/?dataset=archive
```

## Query model

- SQL engine: DuckDB-Wasm in a Web Worker.
- Logical relation: `activities`.
- Every selection query returns `activity_id`.
- Canonical units: metres and seconds.
- A trailing semicolon is unnecessary but accepted.
- Extra projected columns are allowed; `activity_id` determines the selected routes.

Example:

```sql
SELECT activity_id
FROM activities
WHERE distance_m >= 20000
```

See [query schema](docs/query-schema.md).

## Rendering

- GeoArrow buffers move directly from DuckDB to deck.gl.
- Viewport bbox pruning limits candidate files and row groups.
- LOD is selected from zoom plus a vertex budget.
- Render pyramid targets: 40, 100, 400, 2,000 vertices, then raw geometry.
- Resolution budgets: Low 250k, Medium 750k, High 1.25M visible vertices.
- Desktop geometry cache: up to 512 MiB; coarse-pointer devices: 128 MiB.
- Small viewport moves can reuse enclosing cached geometry.
- Heat rendering is computed in the browser from selected geometry.

## Hosted architecture

- Static app + datasets: private S3 origins behind CloudFront.
- Browser query/render path remains DuckDB-Wasm + deck.gl.
- Auth: Cognito; Google federation when configured.
- Control plane: Lambda + API Gateway + DynamoDB.
- Ingest jobs: AWS Batch/Fargate.
- Infrastructure: Pulumi.
- CI/deploy: GitHub Actions with AWS OIDC.
- Development budget target: under $50/month.

See [architecture](docs/architecture.md) and [AWS runbook](infra/aws/README.md).

## Verify

```bash
uv run pytest
uv run ruff check .
uv run mypy
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

## Project docs

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Query schema](docs/query-schema.md)
- [Security](docs/security.md)
- [Auth](docs/auth.md)
- [Benchmarks](docs/benchmarks.md)
- [Decisions](docs/decisions.md)
