# Local-First Activity Map Roadmap

## Implementation status (2026-08-23)

- Stage 0: complete; dependencies are locked and CI uses frozen installs.
- Stage 1: complete; synthetic tests and the full private extracted-directory compile/validation passed.
- Stage 2: complete for local acceptance with browser directory loading, a Vite HTTP-range developer source, DuckDB-Wasm worker execution, native coordinate-array rendering, manifest-bound fitting, standard/imagery/topographic basemaps, and an offline fallback.
- Stage 3: complete for local acceptance with synchronized SQL summaries, versioned local tabs, hover, selection, and on-demand full-route highlighting.
- Stage 4: active (2026-08-22); the requested query-dependent distinct-activity heat, compact controls, query-schema sharing, stronger route focus, linked elevation inspection, binary GeoArrow rendering, and bounded viewport-buffer reuse slices are implemented and locally accepted. Measured planner thresholds and large synthetic benchmark tiers remain pending.
- Hosted V1 slice 1: active (2026-08-23); the user explicitly reordered the roadmap around a client-first control plane. The initial Pulumi/static-delivery resources and private developer dataset are deployed and automated HTTP/range acceptance passes. Hands-on hosted browser acceptance and Stage 4's large synthetic benchmarks remain unresolved.
- Remaining hosted slices and legacy Stages 5–16: not started; the former native-server/hosted-SQL path is superseded for V1 but retained as a possible later measured execution adapter.

Measured deviations: a full compile exposed severe backpressure from converting nested Arrow timestamps to Python objects, and time partitioning produced excessive browser file fan-out. Publication now calls `write_datasink` on the Ray Dataset with `GeoParquetDataSink`; Ray groups rows by coarse activity family, while the sink spatially sorts all years together, chunks complete groups, validates the canonical Pandera/Arrow schema, and writes GeoParquet directly. `start_year` and `start_month` remain scalar SQL columns rather than Hive directories. Manifest metadata is accumulated from the Arrow buffers being written, so publication does not reread activity Parquet; `validate` still rereads it as an independent correctness check. Every compiler function returning a PyArrow table uses a Pandera `Table[Schema]` return type. Pandera's official repository is pinned because the configured index does not yet publish its PyArrow backend.

### Local milestone acceptance — 2026-08-22

- Compiled and validated the completed private extracted export: 3,189 accepted activities and 75 explicit rejections.
- Baseline direct Ray parsing completed in 420.43 seconds; the original month-fragmented sink wrote in 6.32 seconds and produced 322 shards totaling 589,418,400 bytes.
- The family/year grouped compile completed in 522.57 seconds end-to-end (463.05 seconds parsing; 25.74 seconds grouped shuffle/write), producing 49 Hive partitions and 83 shards totaling 510,094,335 bytes. Maximum shard size was 19,813,874 bytes and every shard contained at most the configured 64 rows.
- Browser developer-source acceptance loaded all 3,189 routes without an API server. The real dataset reported `LOD 0 · 3,189 visible / 3,189 selected`; a viewport change reduced the visible route query independently while keeping 3,189 selected. A DuckDB SQL filter updated routes and summaries together to 45 activities.
- Duplicated the successful query into a named tab and confirmed the tab, SQL, active selection, and result restored after reload.
- `uv run activity-map validate data/local/strava`, Python lint/typecheck/tests, and frontend lint/typecheck/tests/build passed. Synthetic browser inspection confirmed the street basemap and visible attribution; standard, topographic, imagery, and blank choices are present.

### Stage 4 requested slice — 2026-08-22

- Added on-the-fly, query-dependent heat preparation. A route contributes at most once to an 8-pixel screen cell, and deck.gl performs the final GPU kernel aggregation. Heat visibility and four colormaps are saved per query tab.
- Added the shared canonical SQL contract in the application and `docs/query-schema.md`, plus a saved example query for runs containing a track sample at or above 3,657.6 m (12,000 ft).
- Compacted the application shell so the logo, saved-query tabs, status, and global controls share one row. A new tab opens the combined dataset/query/style toolbar; clicking the active tab toggles it without a redundant menu control.
- Hover now draws a buffered casing and bright full-route overlay. Selection loads full geometry and an elevation profile; profile hover places a corresponding marker on the route.
- Fixed the LOD compiler after the benchmark showed topology preservation defeating LineString vertex targets. The corrected private compile retained the same 3,189 accepted activities and 75 rejections, completed in 294.24 seconds, produced 83 shards totaling 438,628,862 bytes, and reduced LOD0 from 3,443,070 to 126,494 vertices.
- Live-browser acceptance passed on the corrected dataset: the initial view rendered 3,186 of 3,189 selected routes and built 61 heat cells from 126,377 visible vertices in 16.2 ms. The example query selected 258 activities and built 90 heat cells from 10,055 visible vertices in 1.3 ms, with no UI error.
- Acceptance commands passed: `uv run ruff check .`, `uv run mypy`, `uv run pytest` (8 tests), `uv run activity-map validate data/local/strava`, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm test` (3 tests), `pnpm typecheck`, and `pnpm build`.
- Follow-up experience pass replaced the rejected global heat cloud with per-route proximity coloring. It coalesces identical-density edges into 3,247 colored sections for the full viewport (33.8–39.2 ms) and 600 sections for the 12k-foot query (3.8 ms). The first neighboring-cell union and uncoalesced segment trials are retained in the benchmark record.
- Moved rendering diagnostics into a collapsed toolbar disclosure, collapsed map attribution after initialization, installed the supplied logo in the application header/favicon/statistics and README, added persisted System/Light/Dark themes, and made the richer summary statistics expandable.
- Added responsive toolbar, tab, summary, detail-card, and statistics behavior. A 390×844 headless acceptance pass had no document or toolbar overflow and successfully rendered the 258-activity example query.
- Added an initial 750,000 estimated-visible-vertex downgrade guard. This was superseded by the adaptive promotion planner below; the representation switch for datasets 50 times larger remains benchmark-gated.
- Added schema 1.2 conservative cleaning as derived GeoArrow geometry/LOD/bbox/summary columns plus `track_points.clean`; raw samples remain canonical. The per-tab Clean toggle changes rendering, detail, and summaries and explains its isolated GPS/elevation-spike thresholds.
- Promoted Dataset, AI Skills, Statistics, Table, and Theme to independent header controls while keeping query/map settings closed by default. The temporary bottom summary rail was subsequently removed. Added local deep links and Copy tab link; custom tab contents remain browser-local rather than implying hosted sharing.
- Added automated direct-tab, closed-toolbar, clean-default, and statistics-control acceptance coverage. Python lint/type/tests and frontend lint/tests/typecheck passed before the full schema-1.2 export recompile.
- Full schema-1.2 private compile/validation passed with 3,189 accepted, 75 rejected, and 83 shards totaling 634,436,538 bytes. Aggregate cleaning retained 13,255,070 of 13,255,105 points: 35 isolated elevation samples across two activities and zero spatial-jump samples were excluded from the clean representation.
- The first clean-invariant validator converted nested telemetry to Python and was stopped after exceeding two minutes and 1 GB RSS. The accepted implementation keeps the independent Parquet reread but evaluates nested clean flags/counts and geometry endpoints with DuckDB; validation returns in seconds.
- Local browser acceptance opened the direct-linked 258-activity example at a 390×844 headless viewport, reran it with Clean enabled, opened first-class Statistics, and independently opened AI Skills with query controls hidden. No application error was reported.
- Final acceptance passed: frozen `pnpm` install; Ruff; mypy; 9 Python tests; ESLint; 4 frontend tests; TypeScript typecheck; production Vite build; and validation of the active schema-1.2 private dataset. The existing Vite DuckDB-Wasm bundle-size warning remains recorded below.
- Added per-tab logarithmic heat temperature (0.5–3.0, default 1.7), with higher values saturating low/medium shared-route counts sooner. The measured transfer-function overhead is approximately 0.08 ms for the full-export viewport's 3,247 heat sections.
- Replaced the theme dropdown with compact sun/system/moon buttons. Replaced the textarea with a lazy-loaded schema-aware SQL editor offering highlighting, Ctrl+Space activity-column completion, and visible DuckDB SQL starter queries. DuckDB's native UI/autocomplete extensions were not loaded because the UI excludes Wasm and extension loading would cross the browser security boundary.
- Lazy loading kept the initial JavaScript bundle effectively flat (490.47 kB gzip versus 490.12 kB); the SQL editor is a separate 145.15 kB gzip chunk. A 390×844 real-browser pass verified lazy editor opening, starter-query insertion, temperature persistence, dark-theme selection, and zero document overflow/runtime exceptions.
- Mirrored the active tab, map camera, basemap, heat palette/temperature, Clean state, and route color into replace-only URL parameters; SQL and activity records remain local. Removed the redundant menu button, initially paired Statistics and a visible-route Table in the bottom rail (superseded by the top controls below), and replaced the standalone cleaning note with concise per-parameter hover help. Frontend coverage includes URL restoration and table opening.
- Follow-up acceptance passed Ruff, mypy, 9 Python tests, frozen install, ESLint, 6 frontend tests, TypeScript, production build, and validation of the 3,189-activity local dataset. A 390×844 Chromium pass restored the full URL state, selected 258 routes, opened a 22-row viewport table, switched between Table and Statistics, verified parameter hover help at desktop width, and reported no application exception or horizontal overflow.
- Standardized discretionary UI, route, and elevation-profile accents on blue (`#476BCC`). The profile uses a neutral white casing for contrast, and stored tabs/links using earlier built-in yellow, orange, or blue defaults migrate to the current accent without overwriting custom colors.
- Removed the compact bottom statistics rail; Statistics and Table now live in the top header and close query controls when opened. Extended the browser execution contract with a geometry-free list of every activity in the current SQL selection. All six table columns are sortable with accessible sort state, and clicking a row fits its precomputed bounds before fetching full geometry/detail on demand.
- Frontend lint, 6 tests, typecheck, and production build passed. A 390×844 Chromium pass loaded all 3,189 table rows in 596 ms, verified top placement, sortable maximum elevation, row-to-map navigation, no bottom summary, no horizontal overflow, and no application exception.
- Replaced the zoom-capped LOD choice with a dynamic highest-detail-within-budget planner. The worker estimates all LODs in one aggregation, promotes sparse viewports, reports actual vertices, and uses zoom-tier caps of 750k/900k/1.2M/1.5M. The full export now uses 317,136 LOD1 vertices instead of 126,494 LOD0 vertices, while the tested local viewport uses 146,044 LOD3 vertices instead of the former roughly 8,100-vertex LOD1 ceiling.
- Added full geometry as LOD4, initially gated to zoom 15+ and a 2-million-visible-vertex budget (the later zoom-14 adaptive policy supersedes this threshold). Added a conservative render-time 20 km discontinuity split so corrupt/missing sections are not drawn as anomalous straight lines; heat uses the same split paths.
- Clean now swaps the worker-local logical `activities` projection before user SQL runs. Geometry, LODs, summaries, bbox, point count, and nested telemetry expose their precompiled clean equivalents under the same column names; raw GeoParquet remains canonical and immutable, and no replacement telemetry is fabricated.
- Enlarged elevation profiles to 148 pixels with visible min/max/distance labels, a trace cursor, and an explicit no-source-elevation state. Aggregate inspection found 2,928 of 3,189 accepted activities have at least two elevation samples. Removed duplicate delayed browser tooltips from controls that already have custom hover help.
- Added metric/imperial display controls beside theme; units persist locally and in deep links while SQL storage remains metric. Statistics and Table are now flush right drawers on desktop and full-width bottom sheets on mobile.
- Browser acceptance passed with Clean over all 3,189 activities, the 258-activity example, LOD4 selection at close zoom, a visible 148-pixel elevation profile, desktop/mobile drawer geometry, and no mobile horizontal overflow. Frontend lint, 12 tests, typecheck, and production build passed; the existing DuckDB-Wasm bundle warning remains.
- A hosting-boundary audit found no application API: manifest/shard access and all SQL/summary/LOD/detail work run in DuckDB-Wasm, while heat and drawing run in browser WebGL. Optional basemap tiles are the only third-party runtime requests. MapLibre supports open 3D terrain, but enabling it remains pending a DEM provider/terms and measured camera/rendering decision.
- Full acceptance rerun passed: Ruff, mypy, 9 Python tests, validation of the 3,189-activity ignored dataset, frozen pnpm install, ESLint, 12 frontend tests, TypeScript, and production build. Only the already-recorded Ray deprecation warnings and Vite bundle-size warning remain.
- Deduplicated selected rendering: a selected activity leaves the LOD overview and heat inputs, then renders once from full geometry. A transparent 10-pixel hit layer makes overview routes easier to pick without thickening them, and the activity card can hide/show every other route without changing the SQL result.
- Saved tabs now execute on activation, including the active tab and newly created/duplicated tabs; the active tab continues to toggle query controls. Updated the application accent to `#476BCC` and added theme-selected transparent logo assets derived from the supplied blue/light and white/dark source logos.
- Final acceptance for the selected-route/tab pass succeeded: Ruff, mypy, 9 Python tests, validation of the ignored 3,189-activity dataset, frozen pnpm install, ESLint, 12 frontend tests, TypeScript, and the production build. A 1,440×1,000 Chromium pass verified automatic tab execution, all 258 filtered table rows, full-detail navigation, route isolation, theme-selected header/favicon assets, and no application error.
- Added a logo-triggered About drawer describing the browser-local Parquet/GeoArrow/DuckDB-Wasm/deck.gl scale path and the storytelling rather than route-planning intent. Rendering is now a first-class drawer beside Statistics and Table. This pass trialed zoom 14+ as an explicit raw-geometry mode; the dense-close-view benchmark below later rejected its lack of a budget fallback.
- Acceptance passed for this pass: the private dataset validated at 3,189 accepted/75 rejected; Ruff, mypy, 9 Python tests, frozen install, ESLint, 12 frontend tests, TypeScript, and production build succeeded. Desktop/mobile Chromium verified the About and Rendering drawers, exact 390-pixel header fit, and a populated zoom-14 raw render of 27,139 vertices in 424.3 ms without an application error.
- Replaced the coarse close-zoom width toggle and fixed 6–7 px selection casing with one continuous zoom curve shared by normal, heat, hover, selected, and casing strokes. At default width, the normal route is 2 px at zoom 12, about 1.26 px at zoom 14, and 0.5 px at zoom 18; selected routes floor at 0.8 px while the independent transparent hit target remains 10 px.
- The dynamic-width follow-up passed Ruff, mypy, 9 Python tests, validation of the ignored 3,189-activity dataset, frozen pnpm install, ESLint, 13 frontend tests, TypeScript, and production build. The only warnings remain the recorded Ray deprecations and Vite bundle-size notice.
- Isolated selection now renders one ordinary full-resolution route with the tab color/width and no focus casing, eliminating self-crossing highlight stars. The compiler now uses a true Morton bbox-center order and 16-row Parquet groups inside 64-row spatial shards, retains conservative shard bboxes in the manifest, and lets the browser preselect intersecting files before DuckDB row-group/exact bbox filtering. Rendering diagnostics reports candidate versus total shards; older manifests scan all files.
- The new private compile retained 3,189 accepted/75 rejected activities in 83 shards and produced 230 row groups. A representative sparse viewport preselected 41/83 files and reduced a warm bbox scan from 17.17 ms to 7.56 ms; a dense viewport selected 65/83, documenting the conservative cost of long route bounds.
- Browser HTTP-range acceptance selected 36/83 shards for a populated zoom-14 viewport, transferred 27,139 raw vertices in 281.0 ms, and successfully reused the candidate scan under Clean. Isolating a table-selected activity left the ordinary full route visible with no application error.
- Final acceptance passed: Ruff, mypy, 9 Python tests, validation of the republished 3,189-activity dataset, frozen pnpm install, ESLint, 13 frontend tests, TypeScript, and production build. Only the recorded Ray deprecations and Vite bundle-size warning remain.
- Replaced sampled, section-colored heat geometry with one score/color per complete route. The browser now scores every vertex from the viewport-selected LOD/raw path using cross-activity counts over the same and neighboring screen cells, subtracts self-contributions, and renders only the original route layer. Private-browser measurements scored 316,836 LOD1 vertices in 42.8 ms and 500,371 LOD3 vertices in 69.8 ms without a second low-resolution layer.
- Full heat acceptance passed: Ruff, mypy, 9 Python tests, validation of the 3,189-activity dataset, frozen pnpm install, ESLint, 14 frontend tests, TypeScript, and production build. The private-browser All Activities and high-runs views completed without application errors.
- Slightly increased the continuous route-width curve at every zoom: the default overview is now 2.2 px at zoom 12, about 1.46 px at zoom 14, and about 0.65 px at zoom 18, while retaining a separate wide transparent hit target.
- Moved activity detail/elevation into the same mutually exclusive right drawer system as Statistics, Table, Rendering, and About; on mobile it becomes the same full-width bottom sheet. Opening any first-class drawer now clears the previous drawer instead of overlapping it.
- Fixed FIT elevation loss by merging split record messages with the same timestamp and preferring `enhanced_altitude` over legacy `altitude`. A 30-file diagnostic sample recovered 29 previously blank profiles. The full private compile recovered usable elevation profiles from 2,928/3,189 to 3,188/3,189 activities; the remaining source has no usable elevation and stays explicit rather than fabricated.
- The GeoParquet sink now records row counts and conservative covering bboxes for each in-memory row-group slice before writing. Browser diagnostics reports exact candidate fragments/bytes plus metadata-derived expected row groups, filtered groups, expected rows, kept rows, and pruning/keep efficiency, with a clear estimate label because DuckDB-Wasm does not expose a stable physical row-group counter.
- The elevation/diagnostics private compile retained 3,189 accepted and 75 rejected activities, wrote 83 shards/230 row groups totaling 718,520,706 bytes, and completed parsing in 312.11 seconds plus 36.17 seconds for grouped shuffle/direct publication. Validation confirmed complete row-group metadata and row-count sums; activity Parquet was not reread or rewritten during finalization.
- Acceptance passed: frozen pnpm install; Ruff; mypy; 10 Python tests; ESLint; 14 frontend tests; TypeScript; production build; and validation of the ignored 3,189-activity dataset. Remaining warnings are the already-recorded Ray deprecations, Vite optimize-deps deprecation, and large-bundle notice.
- Rebalanced the route-width curve after visual feedback: default routes are now 2.7 px through overview zoom 12, about 1.35 px at zoom 14, and 0.34 px at zoom 18; focus strokes floor at 0.6 px while the transparent pick target remains wide.
- Removed the empty-dataset welcome card; the persistent Dataset header control is the single open-dataset entry point. Activity detail now offers `Zoom to route`, fitting its full-resolution bounds without closing the shared drawer.
- Added a shared Viewport-only toggle to Statistics and Table. It requires complete route bounds to be contained by the unobscured visible map in DuckDB, preselects manifest fragments conservatively by intersection, and refreshes after settled pans without mutating the saved SQL selection. Route rendering itself continues to use intersection so edge-crossing routes remain visible.
- Recorded and implemented schema 1.3's spatial-first cross-year layout. The densest sanitized viewport dropped from 64/83 candidate fragments and 151/230 row groups to 25/30 fragments and 108/202 row groups. `start_year` is now a scalar Parquet column, activity family remains the coarse Hive key, fragment size is 128 rows, and row-group size remains 16 for range-read pruning.
- Schema 1.3 private acceptance retained 3,189 accepted/75 rejected activities and 3,188 elevation profiles in 30 fragments totaling 718,888,213 bytes. Parsing took 286.50 seconds and grouped direct publication 24.41 seconds; the densest benchmark's warm native LOD3 count scan was 33.0 ms. Frozen install, dataset validation, Ruff, mypy, 10 Python tests, ESLint, 14 frontend tests, TypeScript, and production build passed. At that checkpoint, Browser-Wasm/network timing remained pending because the first available headless Chromium profile lacked a stable WebGL2 context; the software-WebGL follow-up below resolves it.
- Replaced unconditional close-zoom raw reads with the same budgeted planner used by lower zooms. Zoom 14 makes raw eligible under a 2-million-vertex budget; dense views select only an LOD column, and further zooming restores raw automatically. Rendering diagnostics now reports the planned estimate, raw estimate, and budget. A 1,440×1,000 software-WebGL browser pass at zoom 14.17 declined 2,087,813 raw vertices, selected 816,801 estimated LOD3 vertices (812,382 transferred), completed geometry query/transfer in 922.2 ms, and prepared heat in 416.5 ms.
- Benchmarked physical alternatives before changing schema 1.3. Exact LOD0 intersection clustering produced one component containing 78.6% of activities. On the dense local objective, current bbox-center Morton order achieved 64.8% expected-read row efficiency; cluster/time variants achieved 41.6–63.6%, route midpoint 56.0%, and route-coordinate median 60.7%. No compiler layout change was accepted. Front-range-scale queries inherently intersect most archive rows, so their primary optimization is LOD column pruning rather than time interleaving.
- This follow-up passed 15 frontend tests, ESLint, TypeScript, and the production build. The remaining Stage 4 synthetic density tiers and memory/FPS instrumentation are unchanged.
- Replaced viewport `Table.toArray()`/nested coordinate materialization with record-batch-sized binary route payloads. DuckDB's flat `Float64Array` values transfer from the outer worker by ownership and feed deck.gl `PathLayer` attributes directly; scalar route metadata and small segment/picking offsets are materialized, plus deck.gl's required four-byte-per-vertex color attribute when route colors vary. Heat scoring, hover highlighting, selection exclusion, and picking now consume the same coordinate buffers. Single selected activity detail remains the intentionally small object compatibility path for elevation/profile interaction.
- Added an adaptive 256 MiB–1 GiB main-thread LRU for successfully encountered viewport buffers, keyed by dataset, SQL, Clean mode, LOD ceiling, and exact bounds. A cache hit returns the same typed-array identity and bypasses the worker render request; dataset changes clear the cache and least-recently-used batches are evicted under budget pressure. Rendering diagnostics exposes logical buffer bytes, cache usage/hits/evictions, and zero coordinate-object creation.
- Recorded the DuckDB-Wasm compatibility deviation before accepting it: canonical fixed-size coordinate pairs arrive from DuckDB as `List<List<Float64>>`. The worker verifies every inner offset spans exactly two values and retains the underlying flat values buffer. It does not convert to WKB, GeoJSON, or nested points. Literal end-to-end zero-copy remains impossible because DuckDB constructs an Arrow result and WebGL uploads to GPU; this pass removes the avoidable intermediate copy/object graph.
- Binary-rendering acceptance passed on the private dataset in Chromium: 3,189 activities selected; the sanitized dense viewport kept 1,199 routes, transferred 475,883 LOD2 vertices in 7.3 MiB of logical buffers, and completed the cold geometry query/ownership transfer in 912.6 ms. The immediate exact-viewport render hit the 9.3 MiB cache in 0.1 ms; heat scored every binary vertex in 395.5 ms without lowering fidelity. A controlled 1-million-point benchmark reduced intermediate coordinate conversion from 68.53 ms/68.76 MiB heap to 0.06 ms/0.01 MiB while preserving buffer identity; the required variable-color buffer added 24.38 ms and 3.81 MiB. Explicit XY position and per-vertex color layouts passed a fresh software-WebGL redraw without buffer-underflow errors. Frontend tests increased to 19 and tests, ESLint, TypeScript, and production build passed.
- Follow-up camera-path profiling found that React rebuilt deck.gl binary-data wrappers and layer instances on every controlled-view update even though the GeoArrow buffers had not changed. Binary path wrappers and the complete layer set are now memoized across camera-only renders. MapLibre now applies deck.gl's identical controlled camera before paint, removing the former one-frame basemap/overlay drift and preserving cursor-anchored wheel zoom. New query tabs inherit the live camera and style rather than jumping to the default location. Heat scoring retains the same viewport-selected GeoArrow buffers and exact route-level semantics but cooperatively yields instead of monopolizing the UI thread. The broad 316,836-vertex private view changed from one 42.8 ms blocking heat task to 51.0 ms wall time over seven UI slices with an 8.7 ms measured maximum. A private-browser camera acceptance retained the wheel anchor and new-tab location without recording coordinates. Twenty-one frontend tests, ESLint, TypeScript, and the production build pass; the Vite deprecation and bundle-size warnings remain unresolved.
- Rejected and reverted the experimental DuckDB-Wasm pthread slice after its published threaded Parquet extension failed to link against shared memory. No dataset query or speedup was possible, so COI assets/headers, runtime probing/fallback, diagnostics, and the package bump were removed; the app remains on the previously accepted EH/MVP path.
- Added a persisted and deep-linkable 0.5–6.0× route-thickness control, weighted toward broad views so very thick archive overviews fade back to the established close-zoom width. Route/detail fitting now uses deck.gl's pixel-aware bounds fitter and the measured desktop drawer or mobile bottom-sheet occlusion, while viewport-scoped Statistics/Table use the same unobscured map rectangle. Table-row hover drives the same full-route map focus layers without creating a redundant tooltip. Frontend acceptance passed ESLint, TypeScript, 22 tests, and the production build; coverage includes the width curve, URL restoration, and updated containment experience. The existing Vite deprecation and bundle-size warnings remain unresolved.
- Corrected the route-width unit mismatch discovered during visual acceptance: deck.gl `PathLayer` defaults to meter widths, so the calculated values labeled as pixels were collapsing to `widthMinPixels` in broad views. Every overview, heat, hover, selected, isolated, and picking path now explicitly uses pixel units; Rendering diagnostics exposes both the requested scale and units.
- Replaced the horizontal query/settings strip with the shared responsive drawer model: a sectioned right drawer on desktop and bottom sheet on mobile, included in map occlusion measurements. Map, heat, and visual controls apply immediately; Clean automatically refreshes the last successful SQL while preserving an unsaved draft. Clicking the active tab now only toggles the drawer, switching tabs executes that tab's SQL, and explicit Run remains beside the SQL editor as the only way to apply an edited draft.
- Replaced the post-unit-fix zoom width curve with a predictable viewport-relative model. Base route width is 0.15% of the map's shorter dimension at every zoom, heat uses the identical stroke, and the persisted 0.25–4.0× control scales it linearly. A `ResizeObserver` updates widths when the map or responsive drawer layout changes; diagnostics reports the factor, viewport ratio, and resulting pixels.
- Simplified the compact header around the active query and icon-sized view controls, moved saved queries and secondary destinations into a hamburger menu, and consolidated theme and units under System settings. New browsers default to miles while explicit URL and locally stored unit preferences continue to win.

### Hosted V1 slice 1 — static delivery scaffold — 2026-08-23

- Recorded the client-first hosted pivot before provisioning: local Ray remains ETL, browser DuckDB-Wasm/Arrow/WebGL remains analytics, and AWS is initially static/control-plane only. Native server and hosted SQL are out of V1.
- Initially added a typed Pulumi project for both web and data delivery. Before provisioning, revised the boundary: Vercel now owns the static Vite shell, SPA rewriting, TLS, and Git preview/production deployments; Pulumi owns only the private encrypted dataset bucket, CloudFront Origin Access Control and range delivery, incomplete multipart cleanup, and AWS Budget. This avoids using infrastructure-as-code for Vercel and avoids placing the approximately 1 GB archive in Vercel's 100 MB Hobby static-upload path.
- Added Vercel configuration for the monorepo Vite build, immutable hashed assets, `/m/<UUID>` SPA rewriting, and browser security/isolation headers. Dataset objects are not Vercel or Pulumi assets and no real activity data is tracked. The AWS data bucket does not force-destroy and is protected by default.
- Added anonymous `/m/<UUID>` browser opening against `/datasets/<UUID>/dataset.json`, preserving the existing Vite-only `?dataset=` path. This establishes the unlisted share contract without authentication or an application data proxy.
- Frozen install, Pulumi TypeScript validation, frontend ESLint/TypeScript/23 tests/build, Ruff, mypy, and 10 Python tests pass. Pulumi and AWS CLIs are now installed, but Pulumi preview/up, CloudFront range verification, manual developer-dataset upload, and hosted browser acceptance remain pending until the naming gate is resolved and an AWS Identity Center profile is configured. GitHub Actions deployment remains the final slice; no Git remote exists and the configured `gh` credential is invalid.
- Recorded the AWS free-plan constraint: infrastructure defaults to a $10 monthly budget with percentage alerts and refuses configuration above $50. AWS and Pulumi setup, preview, deployment, outputs, and Vercel CLI deployment use their native commands rather than Make wrappers. Secret-bearing local files and Pulumi stacks are ignored; gitleaks is required by pre-commit; future GitHub AWS access must use OIDC rather than access-key secrets.
- Added and resolved the public naming gate. The selected alignment is Squiggles / `squiggles.io` / `ljstrnadiii/squiggles`; Route 53 registration completed on 2026-08-23 and initial registry delegation is propagating.
- Installed Pulumi 3.259.0 and gitleaks 8.30.1 locally. Homebrew's AWS CLI formula conflicted with an existing `aws-sdk-cpp` header set on macOS 13, so no packages were unlinked or overwritten; AWS's signed official user-local installer successfully installed AWS CLI 2.36.29 instead. The Make bootstrap target preserves that non-destructive path.
- Verified the publication-bound secret scan over Git-visible files; it found no leaks. Ignored private datasets, dependency trees, environment files, local Pulumi state, and stack configuration are excluded from publication and the scan does not traverse them.
- Bootstrapped the Pulumi S3 DIY backend with AWS CLI before creating the first stack. Public access is blocked, ownership is enforced, AES-256 encryption and versioning are enabled, and Pulumi connectivity is verified through the `squiggle-dev` SSO profile. Documented this state-only bucket as the necessary exception to Pulumi ownership; its account-derived literal name is not tracked.
- Generated the stack passphrase into macOS Keychain, initialized the S3-backed `dev` stack, updated deprecated Pulumi S3 resource types before deployment, and completed a clean preview of 12 serverless resources with no always-on compute.
- Deployed all 12 hosted-slice resources on 2026-08-23 in 3m11s after configuring a $10 monthly budget with 10%/50%/80% alerts. The empty CloudFront dataset origin returned HTTP 403 as expected before upload.
- Uploaded the compiled private developer dataset—not its source archive—under an ignored high-entropy dataset ID. Local and S3 aggregates match at 32 objects and 718,944,230 bytes; CloudFront returns HTTP 200 for the manifest and HTTP 206 for a Parquet byte range. The dataset is currently unlisted rather than authenticated.
- Added a temporary AWS development application hostname before DNS purchase: Pulumi now manages a separate private versioned web bucket, immutable Vite assets, CloudFront SPA rewriting, browser isolation headers, and distinct `/datasets/*` routing on the existing distribution. The root app, `/m/<UUID>` deep link, and manifest return HTTP 200; the deployed app-shell checksum matches the local production build. Vercel is optional rather than required for this dev slice; hands-on browser acceptance remains pending.
- Rechecked the hosted boundary from the development Mac: root and SPA deep-link requests returned HTTP 200, the cached schema 1.3.0 manifest described 3,189 activities in 30 shards, and a 64 KiB GeoParquet request returned HTTP 206 in 281 ms cold and 83–90 ms warm. A headless Chrome smoke pass loaded the application shell without emitting an application error, but hands-on interaction remains pending. The delivery figures are recorded in `docs/benchmarks.md` and do not replace the outstanding browser/synthetic planner benchmarks.
- Prepared the initial public release: removed verified-unused/generated and future-stage placeholders, renamed the active product/workspace identity to Squiggles while preserving compatibility keys and the deployed Pulumi project URNs, patched the Vitest security advisory, and added Dependabot, parallel CI, gitleaks, GitHub OIDC deployment, and GitHub-only semantic-release. The locally bootstrapped deployment role is bound to the repository's production-environment OIDC claim and cannot change IAM or its own permissions.

Immediate hosted sequence (do not skip gates):

1. Finish `.io` delegation, ACM validation, and the CloudFront alias, then verify the hosted `/m/<UUID>` experience through `squiggles.io`.
2. Push the verified initial repository and confirm CI, OIDC deployment, and the first semantic release.
3. Complete hands-on hosted browser acceptance and the outstanding synthetic planner benchmarks.
4. Add Cognito/Google approval and private delivery before enabling managed upload.

Unresolved for full Stage 4 completion:

- The cardinality/vertex/zoom RenderPlan thresholds still need the committed 1M, 10M, 50M, and 100M synthetic benchmark tiers before replacing the provisional LOD thresholds.
- Browser buffer residency and cache eviction are now instrumented, and the eliminated intermediate heap is benchmarked. Full browser heap peaks and interaction FPS across the required synthetic tiers remain unrecorded; the current bundle-size warning also remains a later delivery optimization.
- Heat preparation operates cooperatively over viewport-pruned query results on the main thread because transferring its buffers would detach them from deck.gl and cloning would double the dominant allocation. Moving cell aggregation earlier into DuckDB/the existing worker remains worth benchmarking against query latency and duplicate work.
- The LRU reuses exact viewport results and does not yet deduplicate overlapping buffers across nearby pans. Fragment/activity-granular reuse should be benchmarked against its index and bookkeeping cost before expanding the cache.

Unresolved at the Stage 1–3 boundary:

- Twelve accepted activities contain reported maximum elevation above 9,000 m. Preserve the canonical source/track values for now; future data-quality policy needs an explicit provenance-aware decision.
- Exact browser memory, query latency, rendering FPS, and measured LOD/MVT planner thresholds remain Stage 4 benchmark work. Stage 2 now applies simple zoom-based LOD thresholds and bbox viewport pruning as its provisional direct-Arrow path; the requested heat slice does not prematurely add MVT.
- Directory-picker sources still require browser buffers because the File System Access API cannot be registered as DuckDB HTTP range files; the Vite developer source uses range reads.
- Production bundles are large because DuckDB-Wasm and MapLibre are local dependencies; code splitting is a later delivery optimization, not a blocker for local acceptance.
- `--target-shard-rows=128` is a measured range-read/file-open heuristic, not a byte guarantee; long, telemetry-heavy activities make row sizes variable. Schema 1.3's measured maximum is 56.8 MB. Byte-aware splitting remains pending a substantially larger archive benchmark.
- Ray's grouped hash shuffle needs at least two local CPU scheduling slots. Explicit `--num-cpus 1` uses the deterministic sort/repartition fallback so constrained development and synthetic tests cannot deadlock.

## Summary

Build the product in gated stages, preserving DuckDB SQL and stable query/rendering contracts while execution evolves from browser-only to hosted AWS.

Stage 0 is already substantially complete. The next milestone is a production-quality Strava archive compiler inspired by `../mvmt` and `../rayzon`: Ray Dataset performs parallel parsing, Pandera validates PyArrow tables, and GeoArrow-native geometries are written as a Hive-partitioned GeoParquet dataset.

Each stage must pass tests, type checking, documentation, and applicable benchmarks before the next begins.

## Stage 0 — Contracts and Tooling

Status: complete (2026-08-22).

- Retain the existing monorepo, Python/TypeScript contracts, CI, strict typing, and architecture rules.
- Finish the remaining baseline housekeeping: generate a committed `pnpm-lock.yaml`, use frozen installs in CI, and confirm all documented verification commands pass.
- Keep `QueryTab`, `SummaryStats`, and `RenderPlan` as stable concepts. Browser and hosted engines may produce different physical render plans.
- Do not introduce ingestion, mapping, services, AWS, or AI while closing this stage.

Acceptance:

- `uv run pytest`
- Python lint and type checking
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- Clean dependency installation from lockfiles

## Stage 1 — Strava Archive to GeoParquet Compiler

### Input and CLI

Implement `packages/ingest` as the shared local/cloud compiler.

Primary interface:

```bash
uv run activity-map compile-strava ARCHIVE.zip --output DATASET_DIR
uv run activity-map validate DATASET_DIR
```

The compiler will:

- Accept a Strava bulk-export ZIP directly.
- Safely inspect and extract only `activities.csv` and supported files beneath `activities/`.
- Match CSV metadata to `.gpx`, `.gpx.gz`, `.fit`, and `.fit.gz` activity files.
- Reject archive path traversal, links, unexpected paths, and decompression-limit violations.
- Never modify or commit the source archive.

### Ray processing pipeline

Use Ray Dataset throughout the scalable portion of the pipeline:

1. Read the archive manifest and `activities.csv` on the driver.
2. Create one Ray Dataset item per activity file, including normalized metadata.
3. Parse files with `map_batches(..., batch_format="pyarrow")`.
4. Return typed PyArrow tables from every batch; avoid pandas/GeoPandas in the hot path.
5. Validate batch outputs using `pandera.pyarrow.DataFrameModel`, typed as `pandera.typing.pyarrow.Table[ActivitySchema]`. Pandera’s direct PyArrow support begins in 0.33 and returns PyArrow tables unchanged. ([Pandera PyArrow documentation](https://pandera.readthedocs.io/en/latest/pyarrow.html))
6. Compute deterministic identifiers, summaries, bounds, simplified geometries, and partition keys.
7. Sort rows spatially within time partitions, then write GeoParquet shards.
8. Aggregate parse and validation failures into a deterministic rejection report.

Ray remains a local execution dependency in this stage; it must not imply AWS or an always-running cluster.

### Canonical row schema

Use one row per activity. The canonical logical dataset contains:

- Identity: `activity_id`, source activity ID, source type, source filename, and optional source URL.
- Metadata: name, sport type, start/end UTC timestamps.
- Summary values: distance, elapsed/moving seconds, elevation gain/loss/min/max, and point count.
- Spatial covering: `xmin`, `ymin`, `xmax`, `ymax`.
- Full route: GeoArrow-native CRS84 `LineString`.
- LOD routes: fixed GeoArrow-native `LineString` columns `geometry_lod0` through `geometry_lod3`.
- Track samples: `list<struct>` containing sequence, timestamp, longitude, latitude, elevation, heart rate, cadence, and power, with nullable optional measurements.
- Provenance: source checksum and compiler/schema version.

Use deterministic activity IDs:

- Prefer the Strava activity ID.
- Otherwise hash normalized source identity, start timestamp, and source-content checksum.
- Reprocessing the same archive must not produce duplicate logical activities.

Pandera validates column presence, scalar types, nullability, ranges, uniqueness, and row-level invariants. Explicit PyArrow-schema tests separately validate nested list/struct types and GeoArrow extension metadata where Pandera cannot express those details.

### Geometry and LOD behavior

- Preserve original coordinate order and generate the full LineString without GeoJSON conversion.
- Use geometry-aware simplification rather than point decimation.
- Preserve route endpoints and reject geometries with fewer than two valid coordinates.
- Treat the proposed LOD vertex counts as benchmark targets rather than fixed guarantees.
- Store all five geometry columns as GeoParquet geometry columns with CRS84 metadata.
- Record per-column geometry types and dataset bounds in GeoParquet 1.1 metadata.
- Use native GeoArrow encoding as the canonical path; add WKB only later as an explicitly benchmarked compatibility export if required by a target reader.

### Storage layout

Write one logical GeoParquet dataset containing multiple shards:

```text
DATASET_DIR/
  dataset.json
  rejections.parquet
  activities/
    activity_family=run/
      part-*.parquet
```

- Hive-partition by coarse activity family. Retain `start_year` and `start_month` in each row for SQL/Parquet pruning while spatially ordering all years together.
- Group/repartition in Ray before `write_datasink`, then size chunks within complete Hive groups. Store bbox covering columns and spatially order rows within each partition using a deterministic space-filling key derived from the route bbox center.
- Do not spatially Hive-partition by route start or centroid; that could hide routes crossing a queried viewport.
- Size output shards and row groups for browser range access, with initial values treated as tunable compiler settings.
- `dataset.json` records schema/compiler versions, activity and rejection counts, time range, overall bbox, partitions, shard paths, sizes, row counts, and checksums.
- `rejections.parquet` is control-plane diagnostics, not part of the canonical activity relation.

### Failure policy

- Malformed or unsupported activities do not discard successfully compiled rows.
- Each rejection records the source path, source activity ID when known, stage, stable reason code, and sanitized message.
- The CLI prints totals and exits successfully when valid output is produced and configured quality thresholds are satisfied.
- Support strict thresholds such as maximum rejection count or fraction; exceeding one produces a nonzero exit after writing the report.
- Archive-level corruption, unsafe paths, missing required metadata, or inability to produce a valid dataset is fatal.

### Validation and tests

Test with synthetic fixtures only:

- GPX, compressed GPX, FIT, and compressed FIT parsing.
- Metadata joins, missing metadata, duplicate identifiers, malformed coordinates, absent telemetry, multiple GPX segments, and timezone normalization.
- Deterministic IDs and byte/logical reproducibility across reruns and different Ray batch sizes.
- LOD endpoint preservation, vertex reduction, valid bounds, and CRS84 metadata.
- Pandera rejection of invalid PyArrow batches.
- Safe ZIP handling and decompression limits.
- Idempotent recompilation and clear overwrite policy.
- DuckDB reads the Hive dataset as one `activities` relation and can query nested track samples.
- PyArrow and at least one independent GeoParquet-aware tool read the result correctly.
- `validate` verifies manifest checksums, schema, partitions, GeoParquet/GeoArrow metadata, unique IDs, bounds, LOD invariants, and rejection totals.

Benchmark before optimizing:

- Parsing throughput and peak memory for GPX versus FIT.
- Ray batch size and concurrency.
- Simplification cost.
- Shard and row-group sizes.
- DuckDB time and bytes scanned for date, sport, elevation, and bbox filters.

## Stages 2–5 — Complete the Local Product

### Stage 2: Browser execution and map

- Add `BrowserDuckDBEngine` in a Web Worker.
- Open `dataset.json` plus its local Hive-partitioned shards through browser file handles.
- Register the canonical dataset as the logical `activities` relation.
- Render native Arrow/GeoArrow route columns with MapLibre and deck.gl.
- Provide a collapsed DuckDB SQL editor and update the map from returned activity IDs.
- Acceptance: a Strava-derived local dataset opens, filters, pans, zooms, and renders without a backend.

### Stage 3: Tabs, summaries, and picking

- Persist query tabs, SQL, map state, and style in local storage.
- Derive all summary statistics by semi-joining selected activity IDs against `activities`.
- Add hover metadata, click-to-lock selection, full-route highlighting, and source links.
- Acceptance: one SQL query updates routes, every summary value, hover results, and a saved tab consistently.

### Stage 4: Rendering planner and heat visualization

- Plan rendering from result cardinality, visible activities, estimated vertices, and zoom.
- Select among density, LOD columns, and full selected geometry.
- Define heat as unique activity traversals rather than raw GPS point density.
- Keep the visual heat layer separate from the simplified picking layer.
- Benchmark synthetic 1M, 10M, 50M, and 100M-point datasets before setting thresholds.

### Stage 5: GeoArrow fast-path decision

- Benchmark the native GeoArrow path against Arrow-to-JavaScript line arrays and a small compatibility GeoJSON path.
- Measure conversion time, transferred bytes, JavaScript heap, initialization latency, and interaction FPS.
- Keep GeoArrow as primary only if measured results support it; record the decision and thresholds.

## Stages 6–7 — Native Execution and SQL Governance

### Stage 6: Local native server

- Add FastAPI and `NativeDuckDBEngine`, reading the same Stage 1 GeoParquet dataset.
- Add a browser/server execution selector without changing tabs or SQL.
- Implement query execution, summaries, activity detail, and dynamic MVT endpoints behind the existing `RenderPlan`.
- Benchmark native MVT against direct browser Arrow rendering before adopting planner thresholds.

### Stage 7: Hosted SQL sandbox

- Validate real DuckDB SQL with an AST parser such as sqlglot; do not create a DSL.
- Allow read-only analytical SQL over authorized logical relations.
- Reject multiple statements, mutations, process controls, extension loading, arbitrary file/URL readers, credentials, and unknown relations before execution.
- Add adversarial tests for local file reads, remote URLs, cross-dataset access, writes, attachments, extensions, and parser bypasses.

## Stages 8–12 — Hosted Product

### Stage 8: Minimal AWS deployment

- Provision persistent resources only through Pulumi.
- Use S3, CloudFront with Origin Access Control, API Gateway HTTP API, Lambda, DynamoDB, Cognito, AWS Budget, and ECR only if container Lambda is necessary.
- Upload an already compiled dataset manually; do not build cloud ingestion yet.
- Keep the stack serverless/scale-to-zero, with concurrency caps, short log retention, lifecycle policies, and $20/$35/$45 alerts under a $50 monthly budget.
- Maintain the explicit prohibition on NAT Gateway, databases, Kubernetes, OpenSearch, caches, and always-on compute without an architecture decision.

### Stage 9: Identity and authorization

- Derive ownership exclusively from verified Cognito JWT claims.
- Authorize dataset access before resolving or reading S3 objects.
- Separate read-only query-worker permissions from ingestion-worker permissions.
- Model users, datasets, tabs, imports, and shares as owner-scoped DynamoDB records.

### Stage 10: Hosted tabs

- Add owner-scoped tab CRUD endpoints and move persistence from local storage to the API when authenticated.
- Preserve offline/local tabs and the same UI/domain model.
- Define conflict handling with version or updated-at preconditions.

### Stage 11: Cloud ingestion

- Upload archives through presigned multipart upload.
- Queue compilation through S3 events and SQS.
- Invoke the exact Stage 1 compiler package in ephemeral workers.
- Start at concurrency one; choose Lambda or ephemeral Fargate/Batch per measured archive resource requirements.
- Publish processed datasets atomically only after validation succeeds.

### Stage 12: Private and unlisted sharing

- Share immutable saved queries rather than accepting visitor-supplied SQL.
- Add expiration and route-location privacy controls before considering sharing complete.
- Apply privacy transformations before producing any shared RenderPlan or activity detail.

## Stages 13–16 — Adapters, Advanced Access, and Release

### Stage 13: AI-assisted SQL

- Provide schema, current SQL, and a natural-language request to the model.
- Return visible SQL with a diff and require an explicit user action to run or save it.
- Send generated SQL through the same validator and normal query API.

### Stage 14: MCP adapter

- Expose schema, validation, preview, tabs, and activity operations through the established HTTP API.
- Keep authorization and DuckDB-specific business logic out of the MCP server.
- Ensure MCP receives no privileged database or storage access.

### Stage 15: Advanced local access

- Add direct local GeoParquet, dataset-directory, and remote HTTP GeoParquet workflows using the same browser engine.
- Defer user-managed S3 credentials until demand and a secure credential design exist.
- Display execution diagnostics such as engine version, latency, files touched, bytes read, rows scanned, and RenderPlan size.

### Stage 16: Reproducible benchmark release

- Generate synthetic, non-identifying datasets at 1M, 10M, 50M, and 100M points.
- Compare browser and hosted summary, filter, viewport, LOD, MVT, and activity-detail paths.
- Record wall/query time, bytes transferred/scanned, row groups, peak memory, Lambda memory, tile size, and FPS.
- Publish reproducible commands, environment details, raw results, and conclusions in the repository.

## Public Interfaces and Compatibility

- The canonical query relation becomes one-row-per-activity `activities`; separate `track_points`, `activity_lod`, and `catalog` relations are removed from the initial design.
- Track points and telemetry are nested under each activity; LODs are fixed geometry columns.
- `Dataset` must carry its manifest/schema version and logical relation registration details.
- `RenderPlan` remains an execution-independent union. Extend it only when measured rendering needs require more than the current Arrow and MVT variants.
- Compiler schema changes require an explicit dataset schema-version migration policy; readers must reject unsupported future versions clearly.
- Browser, server, AI, and MCP paths all use DuckDB SQL over the same logical schema.

## Assumptions and Defaults

- Stage 0 is closed only after its remaining lockfile and clean-install checks pass.
- A “single GeoParquet” means one logical, sharded GeoParquet dataset, not one physical file.
- Hive partitions are coarse `activity_family`; `start_year` and `start_month` remain scalar columns. Spatial acceleration uses bbox covering columns and deterministic cross-year Morton ordering.
- Native GeoArrow geometry is the canonical representation.
- CRS84 coordinates are longitude/latitude.
- Raw point samples remain nested and queryable, but common queries should use activity summaries and LOD geometries.
- Valid activities are preserved when individual files fail, with a machine-readable rejection report and configurable quality thresholds.
- Strava archive layouts may evolve, so file discovery and metadata mapping are isolated behind versioned source-adapter interfaces.
- No real activity archive or derived user-location data may enter source control.
