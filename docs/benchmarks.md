# Benchmarks

## Goals

Track the costs that affect map responsiveness:

- dataset open time
- selection execution time
- viewport render time
- candidate Parquet bytes
- expected row groups
- transferred geometry bytes
- visible vertices
- cache hit rate

## Browser diagnostics

Production logs use the prefix:

```text
[squiggles:perf]
```

Important events:

- `dataset-open`
  - total time
  - manifest time
  - DuckDB worker open time
- `selection-execute`
  - total time
  - requested/planned LOD
  - selected/rendered routes
  - vertices and geometry bytes
  - candidate bytes and row groups
- `viewport-fetch`
  - render latency and transfer metrics
- `viewport-cache-hit`
  - reused geometry
- `network-retry`
  - transient Parquet request retry

## Data-layout benchmark

Use:

```bash
uv run python scripts/benchmark_geoparquet_layout.py
```

Compare layouts by:

- shard count
- row-group count
- bytes scanned
- range-request fan-out
- viewport pruning effectiveness

## Current rendering budgets

| Resolution | Vertex budget |
| --- | ---: |
| Low | 250,000 |
| Medium | 750,000 |
| High | 1,250,000 |

LOD targets: 40, 100, 400, 2,000 vertices/activity, then raw geometry.

## Performance rule

For material optimizations:

- capture baseline diagnostics
- change one major variable at a time
- compare the same dataset/query/camera
- record regressions as well as wins
- prefer reduced latency/data transfer over theoretical complexity improvements
