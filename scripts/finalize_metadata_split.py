from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# Worker request contract and state.
replace(
    "apps/web/src/duckdb.worker.ts",
    '      files: RegisteredFile[];\n      renderLevels:',
    '      files: RegisteredFile[];\n      metadataFiles: RegisteredFile[];\n      renderLevels:',
)
replace(
    "apps/web/src/duckdb.worker.ts",
    '      startingVertexEstimate?: number;\n    }\n  | {\n      id: number;\n      type: "render";',
    '      startingVertexEstimate?: number;\n      needsCanonicalGeometry: boolean;\n    }\n  | {\n      id: number;\n      type: "render";',
)
replace(
    "apps/web/src/duckdb.worker.ts",
    '  | { id: number; type: "summary"; bounds?: Bounds; clean: boolean }\n  | { id: number; type: "table"; bounds?: Bounds; clean: boolean }\n  | { id: number; type: "activity"; activityId: string; clean: boolean };',
    '  | { id: number; type: "summary"; bounds?: Bounds; clean: boolean }\n  | { id: number; type: "table"; bounds?: Bounds; clean: boolean }\n  | { id: number; type: "metadata"; activityId: string; clean: boolean }\n  | { id: number; type: "activity"; activityId: string; clean: boolean };',
)
replace(
    "apps/web/src/duckdb.worker.ts",
    'let registeredFiles: RegisteredFile[] = [];\nlet registeredRenderLevels',
    'let registeredFiles: RegisteredFile[] = [];\nlet registeredCanonicalFiles: RegisteredFile[] = [];\nlet canonicalViewReady = false;\nlet registeredRenderLevels',
)

# Render batches only carry activity ids plus geometry; metadata is fetched lazily on hover.
replace(
    "apps/web/src/duckdb.worker.ts",
    'function metadataAt(columns: Map<string, ArrowVector>, index: number): RouteMetadata {\n  const value = (name: string) => scalar(columns.get(name)!.get(index));\n  return {\n    activityId: String(value("activity_id")),\n    name: String(value("name")),\n    sportType: String(value("sport_type")),\n    startTime: value("start_time")?.toString() ?? null,\n    distanceM: value("distance_m") as number | null,\n    elevationGainM: value("elevation_gain_m") as number | null,\n    maxElevationM: value("max_elevation_m") as number | null,\n    sourceUrl: value("source_url") as string | null,\n  };\n}',
    'function metadataAt(columns: Map<string, ArrowVector>, index: number): RouteMetadata {\n  const activityId = String(scalar(columns.get("activity_id")!.get(index)));\n  return {\n    activityId,\n    name: "",\n    sportType: "",\n    startTime: null,\n    distanceM: null,\n    elevationGainM: null,\n    maxElevationM: null,\n    sourceUrl: null,\n  };\n}',
)
replace(
    "apps/web/src/duckdb.worker.ts",
    '    const names = [\n      "activity_id",\n      "name",\n      "sport_type",\n      "start_time",\n      "distance_m",\n      "elevation_gain_m",\n      "max_elevation_m",\n      "source_url",\n    ];',
    '    const names = ["activity_id"];',
)

# Metadata relation is the only source used for summary/table.
start = Path("apps/web/src/duckdb.worker.ts").read_text()
old = '''function viewportRelation(files: RegisteredFile[], clean: boolean): string | null {
  if (files.length === 0) return null;
  const source = `(${canonicalSourceSql(files)})`;
  if (!clean) return source;
  return `(SELECT * REPLACE (
    geometry_clean AS geometry,
    geometry_clean_lod0 AS geometry_lod0,
    geometry_clean_lod1 AS geometry_lod1,
    geometry_clean_lod2 AS geometry_lod2,
    geometry_clean_lod3 AS geometry_lod3,
    coalesce(clean_distance_m,distance_m) AS distance_m,
    coalesce(clean_elevation_gain_m,elevation_gain_m) AS elevation_gain_m,
    coalesce(clean_elevation_loss_m,elevation_loss_m) AS elevation_loss_m,
    coalesce(clean_min_elevation_m,min_elevation_m) AS min_elevation_m,
    coalesce(clean_max_elevation_m,max_elevation_m) AS max_elevation_m,
    clean_point_count AS point_count,
    clean_xmin AS xmin, clean_ymin AS ymin, clean_xmax AS xmax, clean_ymax AS ymax,
    list_filter(track_points,p->p.clean) AS track_points
  ) FROM ${source})`;
}
'''
new = '''function viewportRelation(files: RegisteredFile[], clean: boolean): string | null {
  const source = parquetRelation(files, false);
  if (!source) return null;
  if (!clean) return source;
  return `(SELECT * REPLACE (
    coalesce(clean_distance_m,distance_m) AS distance_m,
    coalesce(clean_elevation_gain_m,elevation_gain_m) AS elevation_gain_m,
    coalesce(clean_elevation_loss_m,elevation_loss_m) AS elevation_loss_m,
    coalesce(clean_min_elevation_m,min_elevation_m) AS min_elevation_m,
    coalesce(clean_max_elevation_m,max_elevation_m) AS max_elevation_m,
    clean_point_count AS point_count,
    clean_xmin AS xmin, clean_ymin AS ymin, clean_xmax AS xmax, clean_ymax AS ymax
  ) FROM ${source})`;
}
'''
if old not in start:
    raise SystemExit("viewportRelation anchor missing")
Path("apps/web/src/duckdb.worker.ts").write_text(start.replace(old, new, 1))

# Clean metadata view must not bind canonical geometry.
p = Path("apps/web/src/duckdb.worker.ts")
t = p.read_text()
t = t.replace(
    '    await connection!.query("CREATE OR REPLACE TEMP VIEW activity_geometry AS SELECT activity_id,geometry,geometry_clean,xmin,ymin,xmax,ymax,clean_xmin,clean_ymin,clean_xmax,clean_ymax FROM canonical_source");\n',
    '',
)
t = t.replace(
    '    await connection!.query("CREATE OR REPLACE TEMP VIEW activity_geometry AS SELECT activity_id,geometry_clean AS geometry,geometry_clean,xmin,ymin,xmax,ymax,clean_xmin,clean_ymin,clean_xmax,clean_ymax FROM canonical_source");\n',
    '',
)
anchor = '''function selectionJoin(): string {
'''
helper = '''async function ensureCanonicalGeometry(clean: boolean) {
  if (!canonicalViewReady) {
    await connection!.query(
      `CREATE OR REPLACE VIEW canonical_source AS ${canonicalSourceSql(registeredCanonicalFiles)}`,
    );
    canonicalViewReady = true;
  }
  const geometry = clean ? "geometry_clean AS geometry" : "geometry";
  await connection!.query(
    `CREATE OR REPLACE TEMP VIEW activity_geometry AS SELECT activity_id,${geometry},xmin,ymin,xmax,ymax,clean_xmin,clean_ymin,clean_xmax,clean_ymax FROM canonical_source`,
  );
}

function selectionJoin(): string {
'''
if anchor not in t:
    raise SystemExit("selectionJoin anchor missing")
t = t.replace(anchor, helper, 1)

# Overview render is overview-only.
old = '''  const geometry = clean ? "geometry_clean" : "geometry";
  const distance = clean ? "coalesce(m.clean_distance_m,m.distance_m)" : "m.distance_m";
  const gain = clean ? "coalesce(m.clean_elevation_gain_m,m.elevation_gain_m)" : "m.elevation_gain_m";
  const maximum = clean ? "coalesce(m.clean_max_elevation_m,m.max_elevation_m)" : "m.max_elevation_m";
  const result = await connection!.query(
    `SELECT a.activity_id,m.name,m.sport_type,CAST(m.start_time AS VARCHAR) start_time,${distance} distance_m,${gain} elevation_gain_m,${maximum} max_elevation_m,m.source_url,a.${geometry} FROM ${relation} a JOIN activities m USING(activity_id)${selectionJoin()} WHERE ${viewportPredicate(bounds, clean)}`,
  );
'''
new = '''  const geometry = clean ? "geometry_clean" : "geometry";
  const result = await connection!.query(
    `SELECT a.activity_id,a.${geometry} FROM ${relation} a${selectionJoin()} WHERE ${viewportPredicate(bounds, clean)}`,
  );
'''
if old not in t:
    raise SystemExit("render query anchor missing")
t = t.replace(old, new, 1)

# Open binds metadata only; canonical remains cold until exact spatial/detail work.
t = t.replace(
    '      await connection!.query(`CREATE OR REPLACE VIEW canonical_source AS ${canonicalSourceSql(request.files)}`);\n      await connection!.query("CREATE OR REPLACE TEMP VIEW activity_geometry AS SELECT activity_id,geometry,geometry_clean,xmin,ymin,xmax,ymax,clean_xmin,clean_ymin,clean_xmax,clean_ymax FROM canonical_source");\n',
    '      canonicalViewReady = false;\n',
)

# Lazy metadata lookup for hover.
activity_anchor = '''    if (request.type === "activity") {
'''
metadata_handler = '''    if (request.type === "metadata") {
      if (request.clean && !supportsClean) {
        throw new Error("Clean view requires dataset schema 1.2.0 or newer; recompile first");
      }
      await configureActivitiesView(request.clean);
      const table = await connection!.query(
        `SELECT activity_id,name,sport_type,CAST(start_time AS VARCHAR) start_time,distance_m,elevation_gain_m,max_elevation_m,source_url FROM activities WHERE activity_id='${request.activityId.replaceAll("'", "''")}' LIMIT 1`,
      );
      const row = table.toArray()[0] as unknown as Record<string, unknown> | undefined;
      self.postMessage({
        id: request.id,
        ok: true,
        value: row
          ? {
              activityId: String(scalar(row.activity_id)),
              name: String(row.name),
              sportType: String(row.sport_type),
              startTime: row.start_time?.toString() ?? null,
              distanceM: scalar(row.distance_m) as number | null,
              elevationGainM: scalar(row.elevation_gain_m) as number | null,
              maxElevationM: scalar(row.max_elevation_m) as number | null,
              sourceUrl: row.source_url as string | null,
            }
          : null,
      });
      return;
    }

    if (request.type === "activity") {
'''
if activity_anchor not in t:
    raise SystemExit("activity handler anchor missing")
t = t.replace(activity_anchor, metadata_handler, 1)
t = t.replace(
    '      const clean = request.clean && supportsClean;\n      const geometry = clean ? "geometry_clean" : "geometry";',
    '      const clean = request.clean && supportsClean;\n      await ensureCanonicalGeometry(clean);\n      const geometry = clean ? "geometry_clean" : "geometry";',
    1,
)

# Explicit spatial state controls lazy canonical binding; no SQL inspection.
t = t.replace(
    '    await configureActivitiesView(request.clean);\n    selectionAll = isUniversalSelectionSql(request.sql);',
    '    await configureActivitiesView(request.clean);\n    if (request.needsCanonicalGeometry) {\n      await ensureCanonicalGeometry(request.clean && supportsClean);\n    }\n    selectionAll = isUniversalSelectionSql(request.sql);',
)
Path("apps/web/src/duckdb.worker.ts").write_text(t)

# Engine passes explicit spatial need and exposes lazy hover metadata.
replace(
    "apps/web/src/engine.ts",
    '      activity: "load activity detail",',
    '      metadata: "load activity metadata",\n      activity: "load activity detail",',
)
replace(
    "apps/web/src/engine.ts",
    '      startingVertexEstimate: plan.startingVertexEstimate,\n    });',
    '      startingVertexEstimate: plan.startingVertexEstimate,\n      needsCanonicalGeometry: Boolean(tab.spatialFilter?.polygon.length && tab.spatialFilter.polygon.length >= 3),\n    });',
)
replace(
    "apps/web/src/engine.ts",
    '      selected: result.summary.activityCount,',
    '      selected: result.selectedCount,',
)
replace(
    "apps/web/src/engine.ts",
    '  getActivity(activityId: string): Promise<RouteActivity | null> {\n    return this.networkRequest({ type: "activity", activityId, clean: this.clean });\n  }',
    '  getRouteMetadata(activityId: string): Promise<import("./contracts").RouteMetadata | null> {\n    return this.networkRequest({ type: "metadata", activityId, clean: this.clean });\n  }\n\n  getActivity(activityId: string): Promise<RouteActivity | null> {\n    return this.networkRequest({ type: "activity", activityId, clean: this.clean });\n  }',
)

# Contract for hover metadata.
replace(
    "apps/web/src/contracts.ts",
    '  getActivities(bounds?: ViewportBounds): Promise<ActivityListItem[]>;\n  getActivity(activityId: string): Promise<RouteActivity | null>;',
    '  getActivities(bounds?: ViewportBounds): Promise<ActivityListItem[]>;\n  getRouteMetadata(activityId: string): Promise<RouteMetadata | null>;\n  getActivity(activityId: string): Promise<RouteActivity | null>;',
)

# App resolves tooltip metadata lazily only after an actual hover.
p = Path("apps/web/src/App.tsx")
t = p.read_text()
old = 'onHover: (info: PickingInfo) => { if (spatialDrawing) return; const item = info.index >= 0 ? pickedActivity(batch, info.index) : null; setHover(item ? { x: info.x, y: info.y, item, origin: "map" } : null); }, onClick:'
new = 'onHover: (info: PickingInfo) => { if (spatialDrawing) return; const item = info.index >= 0 ? pickedActivity(batch, info.index) : null; if (!item) { setHover(null); return; } const x = info.x, y = info.y, activityId = item.activityId; void engine.getRouteMetadata(activityId).then(metadata => { if (metadata) setHover({ x, y, item: metadata, origin: "map" }); }); }, onClick:'
if old not in t:
    raise SystemExit("App hover anchor missing")
t = t.replace(old, new, 1)
Path("apps/web/src/App.tsx").write_text(t)

# Test mock implements the new metadata call.
replace(
    "apps/web/src/App.test.tsx",
    '    async getActivities() { return [{ activityId: "synthetic-1", name: "Synthetic route", sportType: "Ride", startTime: "2025-01-01", distanceM: 5000, elevationGainM: 100, maxElevationM: 1600, sourceUrl: null, bounds: [-105, 39, -104, 40] }]; }\n    async getActivity()',
    '    async getActivities() { return [{ activityId: "synthetic-1", name: "Synthetic route", sportType: "Ride", startTime: "2025-01-01", distanceM: 5000, elevationGainM: 100, maxElevationM: 1600, sourceUrl: null, bounds: [-105, 39, -104, 40] }]; }\n    async getRouteMetadata() { return { activityId: "synthetic-1", name: "Synthetic route", sportType: "Ride", startTime: "2025-01-01", distanceM: 5000, elevationGainM: 100, maxElevationM: 1600, sourceUrl: null }; }\n    async getActivity()',
)

# Spatial harness now models the split relations explicitly.
p = Path("apps/web/src/spatialSql.duckdb.test.ts")
t = p.read_text()
t = t.replace('CREATE TABLE activities (', 'CREATE TABLE activities (')
insert_anchor = '''    connection.query(`
      INSERT INTO activities VALUES (
        'test', -105.31, 39.97, -105.19, 40.09,
        [
          [-105.29, 39.99],
          [-105.25, 40.02],
          [-105.21, 40.07]
        ]
      )
    `);
'''
insert_new = insert_anchor + '''    connection.query("CREATE TABLE activity_geometry AS SELECT * FROM activities");
'''
if insert_anchor not in t:
    raise SystemExit("spatial harness insert anchor missing")
t = t.replace(insert_anchor, insert_new, 1)
Path("apps/web/src/spatialSql.duckdb.test.ts").write_text(t)

# Keep Python source formatted; temporary helper is deleted by the workflow before commit.
