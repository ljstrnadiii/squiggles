# Render pyramid

Canonical GeoParquet remains the source of truth. Render files are derived and replaceable.

Render pyramid version 2 uses Web Mercator metric simplification tolerances instead of fixed vertex counts per activity:

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

Resolution maps directly to the requested simplification level. Low uses the base zoom-derived LOD, Medium requests one level finer, and High requests two levels finer. The runtime vertex budget remains a safety ceiling and may only downshift toward coarser render levels when a dense viewport would exceed it. The preset budgets are 750k vertices for Low, 1.25M for Medium, and 1.75M for High.

`render_pyramid_version` is written to dataset manifests and registry metadata. After a production deploy, CI scans dataset registry rows and submits derived AWS Batch rebuilds only for datasets whose render version is stale. Derived rebuilds use canonical full geometry and do not require users to upload or re-import their source archive.
