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

A complete LOD below the current ~4 MiB uncompressed Arrow target remains contiguous. Larger levels partition by `activity_family/start_year`; files inside each partition remain byte-bounded while preserving whole activity rows. The target is deliberately a tuning parameter rather than part of the format contract.

The camera selects the coarsest approximately subpixel LOD for the current zoom. Low, Medium, and High only define vertex budgets: 750k, 1.25M, and 1.75M vertices. If the preferred level exceeds budget, the renderer walks to coarser levels until it fits or reaches LOD 0.

Each render row stores `vertex_count` and `clean_vertex_count`. Compiler metadata records covering bboxes plus total/min/max vertex counts for every render file/row group. Universal selections therefore estimate candidate LODs without exploratory Parquet requests. Arbitrary SQL first selects canonical activity IDs and family/year partitions, then limits render files to those partitions before exact estimation or geometry reads.

Spatial bboxes are pruning metadata, not clipping boundaries: activities remain whole features and may extend outside the current viewport or any storage partition.

Published tabs persist their resolved starting LOD and vertex estimate as a one-time startup hint. Reopening a saved camera begins from that known plan; normal adaptive selection resumes afterward.

`render_pyramid_version` is written to dataset manifests and registry metadata. After a production deploy, CI scans dataset registry rows and submits derived AWS Batch rebuilds for stale render versions. Derived rebuilds use canonical full geometry and do not require source re-upload or re-import.
