# Squiggles design

## Rendering and data access

Squiggles uses GeoParquet for both analytical selection and route visualization. PMTiles are intentionally not part of the architecture.

The unit of interaction is an activity. Render geometry is never clipped to a spatial tile boundary, so a route remains a complete feature with a stable `activity_id` even when it extends far outside the current viewport.

Canonical GeoParquet remains the source of truth. The render pyramid is derived and replaceable.

## Render pyramid

The compiler produces a dense ladder of fixed-tolerance render levels. There is roughly one level for every two Web Mercator zoom levels, plus canonical full geometry.

Current tolerances are:

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

LOD is a physical storage boundary. A Parquet row group must never mix render levels.

Each render row stores its simplified geometry and per-activity `vertex_count` / `clean_vertex_count`. The dataset manifest stores, for every physical render chunk and row group:

- LOD and tolerance
- byte size
- row count
- bounding box
- total/min/max vertex count
- total/min/max clean vertex count

These aggregates are compiler metadata; the browser should not need exploratory Parquet reads just to estimate a render plan.

## Physical layout

Render geometry is grouped first by LOD and then into bounded Parquet row groups. Whole activity rows are never split.

The coarsest levels are expected to be very small. If an entire LOD fits under the row-group byte target, it should naturally become one file / one row group, minimizing cold-start range requests.

As archives or finer levels grow, the same fixed tolerance is preserved and the compiler creates additional bounded physical chunks rather than silently changing resolution semantics.

Canonical analytical data continues to use the existing `activity_family` / `start_year` pruning strategy. Finer render levels may use the same partition dimensions when necessary; coarse levels should prefer very few physical objects because their dominant workload is whole-archive or broad-viewport rendering.

The design must generalize across archive sizes. A user recording 40 hours per week should receive the same tolerance semantics as a user recording 10 hours per week. Physical partition count may differ; spatial fidelity must not.

## Runtime LOD selection

LOD selection has two constraints.

### 1. Pixel-scale fidelity

The camera establishes the finest error that can be seen. The renderer starts with the coarsest LOD whose simplification error remains approximately subpixel for the current viewport.

This preserves the normal invariant: use no more geometry than the screen can display.

### 2. Vertex budget

Low / Medium / High are device/render budgets, not different definitions of geometry quality.

Current budgets are:

- Low: 750k vertices
- Medium: 1.25M vertices
- High: 1.75M vertices

For a candidate LOD, the browser intersects the viewport with compiler-recorded chunk/row-group bboxes and sums compiler-recorded vertex counts. If the candidate exceeds the budget, the renderer moves one LOD coarser and repeats until it is under budget or reaches the coarsest level.

Budget fallback is intentionally allowed to exceed the nominal subpixel tolerance. Dense repeated-route hotspots are a normal archive pattern; preserving interactivity is more important than forcing invisible-or-nearly-invisible detail. Diagnostics must report when budget fallback occurred and the effective tolerance/pixel error.

No archive-specific tuning is used.

## Viewport pruning

Spatial metadata is a pruning index, not a clipping scheme.

Each physical chunk and row group has a covering bbox. The browser uses viewport intersection to avoid irrelevant files/row groups, while returned route geometries remain complete activities and may extend outside the viewport.

This gives PMTiles-like spatial request reduction without converting activity geometry into tile fragments.

## Arbitrary SQL

Each query tab may contain arbitrary supported SQL against the logical `activities` relation. SQL selects activity IDs and metadata; the chosen render LOD supplies geometry for the selected activities.

The same LOD pyramid therefore serves both broad visualization and arbitrary query-result rendering. There is no separate visualization database and no large dynamic PMTiles filter to maintain.

## Published links

A published tab persists the resolved starting render plan alongside its camera/query state, including the starting LOD and the vertex estimate used when it was published.

On open, that saved LOD is a startup hint, not a permanent lock. The browser can use the saved plan and manifest metadata to immediately choose the same or a coarser LOD for the current device budget without probing multiple Parquet levels first.

After the initial render, normal adaptive LOD selection resumes as the camera or query changes.

## Diagnostics

Rendering diagnostics and startup diagnostics are one concept: **Diagnostics**.

Diagnostics should be reachable from the normal UI and by tapping the Squiggles logo five times. This is especially important for mobile testing where browser developer tools are inconvenient.

Diagnostics should include, where available:

### Startup

- navigation to app mount
- manifest load
- DuckDB/Wasm initialization
- dataset registration
- first geometry result
- first Squiggle render

### I/O

- file/range request count
- bytes requested before first render
- total GeoParquet bytes
- candidate vs total fragments
- expected/candidate/total row groups

### LOD plan

- map zoom
- pixel-scale requested LOD
- rendered LOD
- reason for fallback
- tolerance
- vertex estimate
- rendered vertices
- vertex budget

### Runtime

- query + transfer time
- GeoArrow buffer bytes
- cache hits / size / evictions
- visible and selected routes
- heat preparation metrics

### Device

- browser / user agent
- viewport
- device pixel ratio
- connection information when exposed by the browser

A Copy Diagnostics action should provide a text snapshot suitable for pasting into an issue or chat.

## Design principles

1. Keep activities whole.
2. Keep LOD semantics tolerance-based and archive-independent.
3. Separate LODs physically so a request never reads irrelevant resolution data.
4. Bound physical chunks by bytes while preserving whole rows.
5. Use compiler metadata to choose a render plan before geometry I/O.
6. Let the vertex budget gracefully move to a coarser LOD in dense hotspots.
7. Persist a published starting LOD to avoid cold-start probe waterfalls.
8. Measure startup and rendering on-device through the Diagnostics UI.
