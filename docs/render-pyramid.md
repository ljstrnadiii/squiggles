# Render pyramid

Canonical GeoParquet remains the source of truth. Render files are derived and replaceable.

Render pyramid version 3 uses Web Mercator metric simplification tolerances and physically separates every LOD so row groups never mix resolutions:

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

The camera selects the coarsest approximately subpixel LOD for the current zoom. Low, Medium, and High are vertex budgets rather than alternate tolerance definitions. The preset budgets are 750k vertices for Low, 1.25M for Medium, and 1.75M for High.

Compiler metadata records covering bboxes plus total/min/max `vertex_count` and `clean_vertex_count` for every physical render row group. The browser uses those aggregates to estimate a viewport before geometry I/O. If the subpixel LOD exceeds the current vertex budget, the renderer moves one LOD coarser at a time until it is under budget or reaches LOD 0. This intentionally permits a small loss of visible fidelity in pathological dense hotspots in exchange for keeping interaction responsive.

Physical render grouping is byte-bounded while preserving whole activity rows. Very coarse levels therefore naturally collapse to one file / one row group for typical archives, minimizing cold-start requests, while larger archives keep the same tolerance and simply produce more physical chunks.

Spatial bboxes are pruning metadata, not clipping boundaries: activities remain whole features and may extend outside the current viewport or any storage chunk boundary.

Published tabs persist their resolved starting LOD and vertex estimate as a startup hint so reopening a saved camera can select a render level without probing multiple Parquet levels. The saved LOD is not a lock; normal adaptive selection resumes after startup.

`render_pyramid_version` is written to dataset manifests and registry metadata. After a production deploy, CI scans dataset registry rows and submits derived AWS Batch rebuilds only for datasets whose render version is stale. Derived rebuilds use canonical full geometry and do not require users to upload or re-import their source archive.
