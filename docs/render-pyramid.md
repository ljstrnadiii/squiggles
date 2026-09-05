# Render pyramid

Canonical GeoParquet remains the source of truth. Render files are derived and replaceable.

Render pyramid version 3 uses Web Mercator metric simplification tolerances:

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

The render pyramid is one logical dataset with `lod` as the first physical partition:

```text
render/
  lod=0/
    part-00000.parquet
  lod=1/
    part-00000.parquet
  ...
  lod=7/
    part-00000.parquet
    part-00001.parquet  # only if the LOD exceeds the file target
```

There is no `activity_family` / `start_year` Hive fan-out in render storage. The primary workload is rectangular viewport rendering across the whole archive, so the physical ordering is spatial-first.

Physical sizing is intentionally decoupled:

- Render row groups target about **4 MiB uncompressed Arrow data** while preserving whole activity rows. This is the mobile-oriented range-read unit.
- Row-group membership is packed with **Sort-Tile-Recursive (STR)**. The compiler uses projected extent aspect ratio when choosing STR x-stripes so groups tend toward compact, roughly square Web Mercator bboxes rather than long irregular strips.
- Within each STR group, rows are secondarily sorted by `activity_family`, `start_year`, then `activity_id` for readable deterministic output and locality for less-common filters.
- Render files target at most about **1 GiB uncompressed Arrow data**. A LOD normally remains one Parquet file containing many ~4 MiB STR row groups; only unusually large levels shard into multiple files.

The 4 MiB and 1 GiB values are tuning targets rather than wire-size guarantees. Parquet compression and column pruning generally reduce actual stored and transferred bytes below the uncompressed Arrow estimates.

The camera selects the coarsest approximately subpixel LOD for the current zoom. Low, Medium, and High only define vertex budgets: 750k, 1.25M, and 1.75M vertices. If the preferred level exceeds budget, the renderer walks to coarser levels until it fits or reaches LOD 0.

Each render row stores `vertex_count` and `clean_vertex_count`. Compiler metadata records covering bboxes plus total/min/max vertex counts for every render file/row group. Universal selections therefore estimate candidate LODs without exploratory Parquet requests. Arbitrary SQL still selects exact activity IDs in canonical `activities`; render geometry is read only from the chosen LOD and spatially relevant STR groups.

Spatial bboxes are pruning metadata, not clipping boundaries: activities remain whole features and may extend outside the current viewport or any storage group.

Published tabs persist their resolved starting LOD and vertex estimate as a one-time startup hint. Reopening a saved camera begins from that known plan; normal adaptive selection resumes afterward.

`render_pyramid_version` is written to dataset manifests and registry metadata. After a production deploy, CI scans dataset registry rows and submits derived AWS Batch rebuilds for stale render versions. Derived rebuilds use canonical full geometry and do not require source re-upload or re-import.
