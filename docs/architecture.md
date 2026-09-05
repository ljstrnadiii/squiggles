# Architecture

## Principles

- GeoParquet is the canonical activity format.
- DuckDB SQL is the query interface.
- Browser rendering stays Arrow/GeoArrow-native.
- PMTiles are intentionally not part of the rendering architecture.
- Activities remain whole features; render geometry is never clipped to spatial tile boundaries.
- Hosted services manage identity, metadata, uploads, and publishing; they do not replace the browser query engine.
- Keep data access private by default.
- Prefer serverless/scale-to-zero infrastructure.

## Data flow

1. Source adapter reads an activity archive.
2. Compiler normalizes activities and telemetry.
3. Compiler writes canonical GeoParquet, the derived Hive-partitioned render dataset, manifest metadata, and rejection records.
4. Browser loads `dataset.json` before reading render geometry.
5. DuckDB-Wasm registers canonical and render Parquet URLs/files.
6. SQL selects `activity_id` values from the logical `activities` relation.
7. Camera scale selects the approximately subpixel fixed-tolerance LOD.
8. Manifest file/row-group bboxes and vertex sums prune and estimate that LOD before geometry I/O.
9. If the estimate exceeds the current vertex budget, the planner walks to coarser LODs.
10. The selected render files transfer GeoArrow buffers to deck.gl without clipping activities.
11. Viewport results are cached in browser memory.

## Browser components

- React UI.
- DuckDB-Wasm Web Worker for SQL, summaries, table data, detail lookup, render partition pruning, and LOD planning.
- deck.gl/WebGL for routes.
- Browser-side heat computation.
- Local storage for user preferences and saved local tabs.
- Diagnostics for startup, network, LOD, query, cache, and device metrics; five taps on the Squiggles logo opens the mobile-friendly panel.

## Render LOD pyramid

Render pyramid version 3 has eight fixed-tolerance LODs, roughly one for every two Web Mercator zoom levels:

| LOD | Tolerance |
| ---: | ---: |
| 0 | 2048 m |
| 1 | 512 m |
| 2 | 128 m |
| 3 | 32 m |
| 4 | 8 m |
| 5 | 2 m |
| 6 | 0.5 m |
| 7 | full geometry |

LOD is the first physical storage boundary. A render file and row group contain exactly one simplification level. Each row records `vertex_count` and `clean_vertex_count`; the manifest records bbox plus sum/min/max vertex counts for each physical file/row group.

Low, Medium, and High are vertex budgets only: 750k, 1.25M, and 1.75M vertices. They do not alter tolerance semantics. Zoom establishes the preferred approximately subpixel LOD; dense hotspots may move to a coarser level to preserve responsiveness.

## Physical render layout

The render pyramid is one logical dataset:

```text
render/
  lod=0/
    part-00000.parquet
  lod=1/
    part-00000.parquet
  ...
  lod=5/
    activity_family=run/
      start_year=2025/
        part-00000.parquet
```

Three independent sizing decisions matter:

- **Logical partitioning** controls pruning. Coarse LODs stay global; detail LODs may use `activity_family/start_year`.
- **Row groups** target about **4 MiB uncompressed Arrow data** and preserve whole activities. This is the mobile-oriented range-read unit.
- **Files** target at most about **1 GiB uncompressed Arrow data**. A logical partition therefore normally remains one Parquet file containing many ~4 MiB row groups; only unusually large partitions shard into multiple files.

The 4 MiB and 1 GiB values are tuning targets, not wire-size guarantees. Parquet compression and column pruning generally make actual HTTP range transfers and stored file sizes smaller than their uncompressed Arrow estimates.

This layout lets the browser choose `lod=N` from zoom without opening other levels. For arbitrary SQL, the selected activities' family/year values prune render files before exact vertex estimation or geometry reads. File and row-group bboxes then prune by viewport. Spatial bounds are indexes only: a route may extend outside the viewport or any storage partition and remains one complete activity.

## Published views

The browser records the last resolved LOD and planned vertex estimate for each rendered tab. Publishing stores those values with the saved camera/query state. Reopening a published link consumes the hint once, avoiding a cold-start LOD probe waterfall; normal adaptive planning resumes afterward.

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

- LOD-first Hive render partitions.
- `activity_family/start_year` pruning for detail render levels.
- Spatially ordered whole activities.
- ~4 MiB render row groups for mobile-oriented range reads.
- ~1 GiB maximum uncompressed file target, normally one file per logical partition.
- Manifest file/row-group bboxes and vertex sums.
- Column pruning and HTTP range reads.
- Budget-driven coarser-LOD fallback for dense repeated-route hotspots.
- Binary Arrow transfer instead of GeoJSON/object expansion.
- In-memory viewport cache and padded follow-up fetches.
