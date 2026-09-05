from pathlib import Path
import re


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


def sub(path: str, pattern: str, repl: str) -> None:
    p = Path(path)
    text = p.read_text()
    text2, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"pattern count {count} in {path}: {pattern[:100]!r}")
    p.write_text(text2)

# Manifest + execute contract.
replace("apps/web/src/contracts.ts", "export type QueryResult = { queryId: string; summary: SummaryStats; renderPlan: RenderPlan };", "export type QueryResult = { queryId: string; selectedCount: number; renderPlan: RenderPlan };")
replace("apps/web/src/contracts.ts", "  shards: DatasetFileManifest[];\n  render_levels?: RenderLevelManifest[];", "  metadata?: DatasetFileManifest[];\n  shards: DatasetFileManifest[];\n  render_levels?: RenderLevelManifest[];")

# Metadata is the logical activities relation; canonical stays cold detail/spatial data.
p = Path("apps/web/src/duckdb.worker.ts")
t = p.read_text()
t = t.replace('      files: RegisteredFile[];\n      renderLevels:', '      files: RegisteredFile[];\n      metadataFiles: RegisteredFile[];\n      renderLevels:')
t = t.replace('let registeredFiles: RegisteredFile[] = [];', 'let registeredFiles: RegisteredFile[] = [];\nlet registeredCanonicalFiles: RegisteredFile[] = [];')
t = t.replace('function viewportRelation(files: RegisteredFile[], clean: boolean): string | null {\n  if (files.length === 0) return null;\n  const source = `(${canonicalSourceSql(files)})`;\n  if (!clean) return source;\n  return `(SELECT * REPLACE (\n    geometry_clean AS geometry,\n    geometry_clean_lod0 AS geometry_lod0,\n    geometry_clean_lod1 AS geometry_lod1,\n    geometry_clean_lod2 AS geometry_lod2,\n    geometry_clean_lod3 AS geometry_lod3,\n    coalesce(clean_distance_m,distance_m) AS distance_m,\n    coalesce(clean_elevation_gain_m,elevation_gain_m) AS elevation_gain_m,\n    coalesce(clean_elevation_loss_m,elevation_loss_m) AS elevation_loss_m,\n    coalesce(clean_min_elevation_m,min_elevation_m) AS min_elevation_m,\n    coalesce(clean_max_elevation_m,max_elevation_m) AS max_elevation_m,\n    clean_point_count AS point_count,\n    clean_xmin AS xmin, clean_ymin AS ymin, clean_xmax AS xmax, clean_ymax AS ymax,\n    list_filter(track_points,p->p.clean) AS track_points\n  ) FROM ${source})`;\n}', 'function viewportRelation(files: RegisteredFile[], clean: boolean): string | null {\n  const source = parquetRelation(files, false);\n  if (!source) return null;\n  if (!clean) return source;\n  return `(SELECT * REPLACE (\n    coalesce(clean_distance_m,distance_m) AS distance_m,\n    coalesce(clean_elevation_gain_m,elevation_gain_m) AS elevation_gain_m,\n    coalesce(clean_elevation_loss_m,elevation_loss_m) AS elevation_loss_m,\n    coalesce(clean_min_elevation_m,min_elevation_m) AS min_elevation_m,\n    coalesce(clean_max_elevation_m,max_elevation_m) AS max_elevation_m,\n    clean_point_count AS point_count,\n    clean_xmin AS xmin, clean_ymin AS ymin, clean_xmax AS xmax, clean_ymax AS ymax\n  ) FROM ${source})`;\n}')
sub("apps/web/src/duckdb.worker.ts", r'async function configureActivitiesView\(clean: boolean\) \{.*?\n\}\n\nfunction selectionJoin', '''async function configureActivitiesView(clean: boolean) {\n  const enabled = clean && supportsClean;\n  if (enabled === cleanViewEnabled) return;\n  if (!enabled) {\n    await connection!.query("CREATE OR REPLACE TEMP VIEW activities AS SELECT * FROM activity_source");\n    await connection!.query("CREATE OR REPLACE TEMP VIEW activity_geometry AS SELECT activity_id,geometry,geometry_clean,xmin,ymin,xmax,ymax,clean_xmin,clean_ymin,clean_xmax,clean_ymax FROM canonical_source");\n  } else {\n    await connection!.query(`CREATE OR REPLACE TEMP VIEW activities AS SELECT * REPLACE (\n      coalesce(clean_distance_m,distance_m) AS distance_m,\n      coalesce(clean_elevation_gain_m,elevation_gain_m) AS elevation_gain_m,\n      coalesce(clean_elevation_loss_m,elevation_loss_m) AS elevation_loss_m,\n      coalesce(clean_min_elevation_m,min_elevation_m) AS min_elevation_m,\n      coalesce(clean_max_elevation_m,max_elevation_m) AS max_elevation_m,\n      clean_point_count AS point_count,\n      clean_xmin AS xmin, clean_ymin AS ymin, clean_xmax AS xmax, clean_ymax AS ymax\n    ) FROM activity_source`);\n    await connection!.query("CREATE OR REPLACE TEMP VIEW activity_geometry AS SELECT activity_id,geometry_clean AS geometry,geometry_clean,xmin,ymin,xmax,ymax,clean_xmin,clean_ymin,clean_xmax,clean_ymax FROM canonical_source");\n  }\n  cleanViewEnabled = enabled;\n}\n\nfunction selectionJoin''')
# Render query joins only the lightweight metadata relation.
sub("apps/web/src/duckdb.worker.ts", r'  const geometry = clean \? "geometry_clean" : "geometry";\n  const distance = .*?\n  const result = await connection!\.query\(\n    `SELECT .*?\n  \);', '''  const geometry = clean ? "geometry_clean" : "geometry";\n  const distance = clean ? "coalesce(m.clean_distance_m,m.distance_m)" : "m.distance_m";\n  const gain = clean ? "coalesce(m.clean_elevation_gain_m,m.elevation_gain_m)" : "m.elevation_gain_m";\n  const maximum = clean ? "coalesce(m.clean_max_elevation_m,m.max_elevation_m)" : "m.max_elevation_m";\n  const result = await connection!.query(\n    `SELECT a.activity_id,m.name,m.sport_type,CAST(m.start_time AS VARCHAR) start_time,${distance} distance_m,${gain} elevation_gain_m,${maximum} max_elevation_m,m.source_url,a.${geometry} FROM ${relation} a JOIN activities m USING(activity_id)${selectionJoin()} WHERE ${viewportPredicate(bounds, clean)}`,\n  );''')
# Open registers canonical + metadata + overview, with list reads and appropriate Hive behavior.
t = Path("apps/web/src/duckdb.worker.ts").read_text()
t = t.replace('      registeredFiles = request.files;\n      registeredRenderLevels', '      registeredCanonicalFiles = request.files;\n      registeredFiles = request.metadataFiles;\n      registeredRenderLevels')
t = t.replace('      for (const file of [...request.files, ...renderFilesToRegister]) {', '      for (const file of [...request.files, ...request.metadataFiles, ...renderFilesToRegister]) {')
t = t.replace('        `CREATE OR REPLACE VIEW activity_source AS ${canonicalSourceSql(request.files)}`,', '        `CREATE OR REPLACE VIEW activity_source AS ${parquetRelation(request.metadataFiles, false)}`,')
t = t.replace('      const activitySourceViewMs = performance.now() - activitySourceStarted;\n      const activitiesStarted', '      const activitySourceViewMs = performance.now() - activitySourceStarted;\n      await connection!.query(`CREATE OR REPLACE VIEW canonical_source AS ${canonicalSourceSql(request.files)}`);\n      await connection!.query("CREATE OR REPLACE TEMP VIEW activity_geometry AS SELECT activity_id,geometry,geometry_clean,xmin,ymin,xmax,ymax,clean_xmin,clean_ymin,clean_xmax,clean_ymax FROM canonical_source");\n      const activitiesStarted')
t = t.replace('supportsClean = ["1.2.0", "1.3.0", "1.4.0"].includes(request.schemaVersion);', 'supportsClean = ["1.2.0", "1.3.0", "1.4.0", "1.5.0"].includes(request.schemaVersion);')
t = t.replace(' FROM activities WHERE activity_id=', ' FROM canonical_source WHERE activity_id=')
# Decouple summary from execute and return selected count only.
t = t.replace('    const clean = request.clean && supportsClean;\n    const viewport = await render(', '    const selectedCount = selectionAll\n      ? registeredFiles.reduce((total, file) => total + file.rowCount, 0)\n      : Number(scalar((await connection!.query("SELECT count(*) total FROM current_selection")).toArray()[0]?.total ?? 0));\n    const clean = request.clean && supportsClean;\n    const viewport = await render(')
t = t.replace('    const summary = await summarize(undefined, clean);\n    respond(request.id, {\n      queryId: String(request.id),\n      summary,', '    respond(request.id, {\n      queryId: String(request.id),\n      selectedCount,')
Path("apps/web/src/duckdb.worker.ts").write_text(t)

# Generated spatial predicate: bbox candidates from metadata, exact geometry only from canonical.
p = Path("apps/web/src/spatialSql.ts")
t = p.read_text().replace('FROM activities a\nSEMI JOIN spatial_candidate_ids c', 'FROM activity_geometry a\nSEMI JOIN spatial_candidate_ids c')
p.write_text(t)

# Engine passes metadata separately and no longer blocks execute on summary.
p = Path("apps/web/src/engine.ts")
t = p.read_text()
t = t.replace('    if (!["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"].includes(manifest.schema_version)) {', '    if (!["1.5.0"].includes(manifest.schema_version)) {')
t = t.replace('    const files: WorkerFile[] = [];\n    const renderLevels', '    const files: WorkerFile[] = [];\n    const metadataFiles: WorkerFile[] = [];\n    const renderLevels')
t = t.replace('    const totalEntries = manifest.shards.length + renderEntries.length;', '    const metadataEntries = manifest.metadata ?? [];\n    const totalEntries = manifest.shards.length + metadataEntries.length + renderEntries.length;')
t = t.replace('      for (const shard of manifest.shards) files.push(workerFile(shard));\n      for (const level', '      for (const shard of manifest.shards) files.push(workerFile(shard));\n      for (const entry of metadataEntries) metadataFiles.push(workerFile(entry));\n      for (const level')
t = t.replace('      for (const shard of manifest.shards) files.push(await load(shard));\n      for (const level', '      for (const shard of manifest.shards) files.push(await load(shard));\n      for (const entry of metadataEntries) metadataFiles.push(await load(entry));\n      for (const level')
t = t.replace('      files,\n      renderLevels,', '      files,\n      metadataFiles,\n      renderLevels,')
t = t.replace('[...files, ...allRenderFiles].flatMap', '[...files, ...metadataFiles, ...allRenderFiles].flatMap')
t = t.replace('files: [...files.map((file) => file.name), ...allRenderFiles.map((file) => file.name)],', 'files: [...files.map((file) => file.name), ...metadataFiles.map((file) => file.name), ...allRenderFiles.map((file) => file.name)],')
Path("apps/web/src/engine.ts").write_text(t)

# App: paint first, load summary independently. Existing viewport-scoped summary/table logic stays intact.
p = Path("apps/web/src/App.tsx")
t = p.read_text()
old = 'setRouteBatches(result.batches); setRenderedView(mapState); setSummary(result.summary); setScopedSummary(result.summary);\n      selectionReady.current = true;'
new = 'setRouteBatches(result.batches); setRenderedView(mapState);\n      selectionReady.current = true;\n      void engine.getSummary().then(value => { setSummary(value); if (!viewportScope) setScopedSummary(value); }).catch(error => setError(error instanceof Error ? error.message : String(error)));'
t = t.replace(old, new)
t = t.replace('setStatus(`${result.summary.activityCount.toLocaleString()} routes selected`);', 'setStatus(`${result.selectedCount.toLocaleString()} routes selected`);')
Path("apps/web/src/App.tsx").write_text(t)

# Query schema no longer advertises geometry/track_points through the hot activities relation.
p = Path("apps/web/src/querySchema.ts")
t = p.read_text().replace('schema 1.4.0', 'schema 1.5.0')
for marker in ['geometry DOUBLE[2][] NOT NULL', 'geometry_lod0 DOUBLE[2][] NOT NULL', 'geometry_lod1 DOUBLE[2][] NOT NULL', 'geometry_lod2 DOUBLE[2][] NOT NULL', 'geometry_lod3 DOUBLE[2][] NOT NULL', 'geometry_clean DOUBLE[2][] NOT NULL', 'geometry_clean_lod0 DOUBLE[2][] NOT NULL', 'geometry_clean_lod1 DOUBLE[2][] NOT NULL', 'geometry_clean_lod2 DOUBLE[2][] NOT NULL', 'geometry_clean_lod3 DOUBLE[2][] NOT NULL']:
    t = re.sub(re.escape(marker) + r'.*?\n', '', t)
t = re.sub(r'track_points STRUCT\(.*?\)\[\] NOT NULL\n', '', t, flags=re.S)
t = t.replace('Raw geometry, telemetry, and summaries remain canonical.', 'Full geometry and telemetry remain canonical detail data; selection, table, and summaries use metadata Parquet.')
Path("apps/web/src/querySchema.ts").write_text(t)

# Test expectations for the new manifest/request contract.
p = Path("apps/web/src/engine.test.ts")
t = p.read_text().replace('schema_version: "1.4.0"', 'schema_version: "1.5.0"')
# Synthetic manifests need a metadata file; use the existing shard descriptor as a cheap fixture.
t = t.replace('shards: [shard],\n', 'metadata: [shard],\n      shards: [shard],\n')
p.write_text(t)
