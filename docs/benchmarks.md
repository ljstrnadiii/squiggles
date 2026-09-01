# Benchmarks

Only aggregate, non-location measurements belong here.

## Reference activity archive

- 3,189 accepted activities.
- 75 rejected inputs.
- 13,255,105 raw points.
- 13,255,070 clean points.
- Current source adapter: Strava export.
- Activity files include FIT, GPX, and TCX.

## LOD compiler

Measured totals:

- LOD0: 126,494 vertices.
- LOD1: 317,136.
- LOD2: 1,259,440.
- LOD3: 5,708,384.
- Full: 13,255,105.

Key result:

- Non-topology-preserving Douglas–Peucker reduced the failed LOD0 trial from 3.44M vertices to 126k while retaining endpoints and validation limits.

## Canonical Parquet layout

Accepted layout:

- Hive partition by `activity_family` only.
- Spatial Morton ordering across years.
- 512-row target shards.
- 128-row Parquet row groups.

Measured comparison:

- Previous candidate: 30 files / 202 groups / 718.9 MB.
- Accepted layout: 11 files / 30 groups / 574.3 MB.
- Compressed size: ~20% lower.
- Warm full-archive LOD0 aggregate: ~19.4 ms → ~11.2 ms midpoint.
- Tradeoff: fewer range/file opens, coarser narrow-view row pruning.

## Spatial pruning

Earlier 64-row/16-row-group layout:

- Sparse viewport candidate files: 41/83.
- Warm bbox scan: 17.17 ms → 7.56 ms with manifest file pruning.
- Dense viewports prune less because long-route conservative bboxes overlap widely.

Current diagnostics report:

- candidate/total fragments
- candidate bytes
- expected/candidate/total row groups
- expected/kept rows

## Browser rendering

Reference observations:

- Broad archive LOD0: ~126k visible vertices.
- Full-selection table metadata for 3,189 activities: 596 ms in a measured mobile-size browser pass.
- Example filtered selection: 258 activities; measured selection/render pass was 4.70 s before later startup optimization work.
- Raw close-view example: 27,139 vertices transferred in 424 ms.
- Dense raw trial: 4.76M vertices took 8.50 s and was rejected as an unconditional close-zoom strategy.

## Heat

Current heat uses one score/color per route over selected render geometry.

Measured examples:

- 316,836 LOD1 vertices: 42.8 ms.
- 500,371 LOD3 vertices: 69.8 ms.
- Temperature color-transfer overhead is negligible relative to route scoring.

Rejected approaches:

- Global heat cloud: poor visual semantics.
- Rebuilding large neighboring-cell activity sets: exceeded interaction budget.
- Uncoalesced per-edge rendering: too many path instances.

## SQL editor

- Eager editor increased initial gzip JS from ~490 kB to ~636 kB.
- Lazy loading restored initial gzip JS to ~490 kB.
- Editor chunk: ~145 kB gzip, loaded only when query controls open.

## Clean representation

- Clean fields increased an earlier compressed canonical dataset from ~438.6 MB to ~634.4 MB.
- Accepted because switching Clean becomes a column/view operation instead of runtime anomaly computation.
- Raw telemetry is not duplicated.

## Performance policy

For every optimization record:

- workload/dataset tier
- before measurement
- after measurement
- transferred bytes/vertices when relevant
- correctness tradeoff
- whether the change was accepted or rejected

Open benchmark work:

- startup phase timings in production
- universal-selection fast path
- 1M/10M/50M/100M synthetic tiers
- Arrow vs MVT crossover
- chunk/tile cache vs viewport-result cache
