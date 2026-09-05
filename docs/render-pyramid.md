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

The render pyramid is one logical Hive-style dataset with `lod` as the first physical partition:

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

Physical sizing is intentionally decoupled:

- Render row groups target about **4 MiB uncompressed Arrow data** while preserving whole activity rows. This is the mobile-oriented range-read unit.
- Render files target at most about **1 GiB uncompressed Arrow data**. A logical partition normally remains one Parquet file containing many ~4 MiB row groups; only unusually large partitions shard into multiple files.
- Logical partitioning exists for pruning, not because a row group reached 4 MiB. Coarse LODs remain global; detail LODs may use `activity_family/start_year`.

The 4 MiB and 1 GiB values are tuning targets rather than wire-size guarantees. Parquet compression and column pruning generally reduce actual stored and transferred bytes below the uncompressed Arrow estimates.

The camera selects the coarsest approximately subpixel LOD for the current zoom. Low, Medium, and High only define vertex budgets: 750k, 1.25M, and 1.75M vertices. If the preferred level exceeds budget, the renderer walks to coarser levels until it fits or reaches LOD 0.

Each render row stores `vertex_count` and `clean_vertex_count`. Compiler metadata records covering bboxes plus total/min/max vertex counts for every render file/row group. Universal selections therefore estimate candidate LODs without exploratory Parquet requests. Arbitrary SQL first selects canonical activity IDs and family/year partitions, then limits render files to those partitions before exact estimation or geometry reads.

Spatial bboxes are pruning metadata, not clipping boundaries: activities remain whole features and may extend outside the current viewport or any storage partition.

Published tabs persist their resolved starting LOD and vertex estimate as a one-time startup hint. Reopening a saved camera begins from that known plan; normal adaptive selection resumes afterward.

`render_pyramid_version` is written to dataset manifests and registry metadata. After a production deploy, CI scans dataset registry rows and submits derived AWS Batch rebuilds for stale render versions. Derived rebuilds use canonical full geometry and do not require source re-upload or re-import.
