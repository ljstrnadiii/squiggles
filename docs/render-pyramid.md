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

## Screen-space fidelity

“Subpixel” refers to route geometry error on the rendered map, not the intrinsic ground-sample distance of the basemap imagery. The browser computes Web Mercator ground resolution at the camera center:

```text
meters_per_css_pixel = earth_circumference * cos(latitude) / (512 * 2^zoom)
```

It then chooses the coarsest fixed tolerance whose simplification error is no larger than one rendered CSS pixel. Latitude therefore matters in addition to zoom.

Basemap provider resolution and overview metadata are intentionally not part of this decision. Squiggles currently uses ordinary 256px XYZ raster sources for streets, topo, and imagery; those tile URLs do not expose a reliable native imagery GSD. More importantly, imagery GSD answers how sharp the underlying raster is, while route simplification visibility is determined by the screen-space map projection. Basemap `maxzoom` controls tile availability/overscaling, not route fidelity.

Low, Medium, and High only define vertex budgets: 750k, 1.25M, and 1.75M vertices. If the screen-space preferred level exceeds budget, the renderer walks to coarser levels until it fits or reaches LOD 0. Dense repeated-route hotspots may therefore intentionally use more than one pixel of simplification error to preserve interaction performance.

Each render row stores `vertex_count` and `clean_vertex_count`. Compiler metadata records covering bboxes plus total/min/max vertex counts for every render file/row group. Universal selections therefore estimate candidate LODs without exploratory Parquet requests. Arbitrary SQL still selects exact activity IDs in canonical `activities`; render geometry is read only from the chosen LOD and spatially relevant STR groups.

Spatial bboxes are pruning metadata, not clipping boundaries: activities remain whole features and may extend outside the current viewport or any storage group.

## Published startup plans

Each successful render computes the appropriate starting plan for all three resolution budgets in a single walk down the LOD ladder. Publishing stores the Low, Medium, and High `{lod, vertexEstimate}` plans together with the viewport bounds from which those estimates were computed.

When a published link opens, the browser immediately selects the saved plan matching the visitor's Low/Medium/High setting. The saved vertex estimate is trusted only when the opening viewport is contained by the saved viewport; a wider viewport keeps the saved LOD as a hint but recomputes the budget check because it may contain more activities. Normal adaptive planning resumes after startup.

## Versioning and rebuilds

`render_pyramid_version` is written to dataset manifests and registry metadata. Any physical render-layout, render-manifest, fixed-tolerance, or compiler change that requires rebuilding derived render data must bump `RENDER_PYRAMID_VERSION` in the same PR.

PR CI compiles and validates the current dataset format from synthetic source data and checks the version bump for format-sensitive changes. Production user archives are not exposed to untrusted PR code. After a production deploy, trusted CI scans dataset registry rows and submits derived AWS Batch rebuilds for stale render versions. Derived rebuilds use canonical full geometry and do not require source re-upload or re-import.
