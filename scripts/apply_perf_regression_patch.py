from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise RuntimeError(f"missing expected text in {path}: {old[:80]!r}")
    file.write_text(text.replace(old, new))


replace(
    "apps/web/src/App.tsx",
    """      selectionReady.current = false;\n      setSelected(null); setProfileHover(null); setHover(null); setIsolateSelected(false);\n      setTableOpen(false); setTableActivities([]);\n""",
    """      selectionReady.current = false;\n      setRouteBatches([]);\n      setSelected(null); setProfileHover(null); setHover(null); setIsolateSelected(false);\n      setTableOpen(false); setTableActivities([]);\n""",
)
replace(
    "apps/web/src/App.tsx",
    """      selectionReady.current = true;\n      void engine.getSummary().then(value => { setSummary(value); if (!viewportScope) setScopedSummary(value); }).catch(error => setError(error instanceof Error ? error.message : String(error)));\n""",
    """      selectionReady.current = true;\n""",
)
replace(
    "apps/web/src/App.tsx",
    """      setStatus(\"Query failed · previous result preserved\");\n""",
    """      setStatus(\"Query failed\");\n""",
)
replace(
    "apps/web/src/App.tsx",
    """  function toggleStats() {\n    setSelected(null); setProfileHover(null); setIsolateSelected(false);\n    setTableOpen(false); setRenderingOpen(false); setAboutOpen(false); setToolbarOpen(false); setStatsOpen(open => !open);\n  }\n""",
    """  async function toggleStats() {\n    if (statsOpen) { setStatsOpen(false); return; }\n    setSelected(null); setProfileHover(null); setIsolateSelected(false);\n    setTableOpen(false); setRenderingOpen(false); setAboutOpen(false); setToolbarOpen(false); setStatsOpen(true);\n    if (!selectionReady.current || viewportScope) { setScopeLoading(viewportScope); return; }\n    try {\n      setScopeLoading(true); setError(\"\");\n      const value = await engine.getSummary();\n      setSummary(value); setScopedSummary(value);\n    } catch (reason) {\n      setStatsOpen(false); setError(reason instanceof Error ? reason.message : String(reason));\n    } finally {\n      setScopeLoading(false);\n    }\n  }\n""",
)
replace(
    "apps/web/src/App.tsx",
    """onClick={() => { toggleStats(); setMenuOpen(false); }}""",
    """onClick={() => { void toggleStats(); setMenuOpen(false); }}""",
)

replace(
    "apps/web/src/storage.ts",
    """  sql: `SELECT activity_id\nFROM activities\nWHERE lower(sport_type) LIKE '%run%'\n  AND EXISTS (\n    SELECT 1\n    FROM unnest(track_points) AS points(point)\n    WHERE point.elevation_m >= 3657.6\n  )`,\n""",
    """  sql: `SELECT activity_id\nFROM activities\nWHERE lower(sport_type) LIKE '%run%'\n  AND max_elevation_m >= 3657.6`,\n""",
)
replace(
    "apps/web/src/SqlEditor.tsx",
    '  "xmin", "ymin", "xmax", "ymax", "geometry", "geometry_clean", "track_points",\n',
    '  "xmin", "ymin", "xmax", "ymax",\n',
)
replace(
    "apps/web/src/SqlEditor.tsx",
    """  high: `SELECT activity_id\nFROM activities\nWHERE EXISTS (\n  SELECT 1\n  FROM unnest(track_points) AS points(point)\n  WHERE point.elevation_m >= 3657.6\n)`,\n""",
    """  high: `SELECT activity_id\nFROM activities\nWHERE max_elevation_m >= 3657.6`,\n""",
)

replace(
    "apps/web/src/engine.ts",
    """  private consumedPublishedPlans = new Set<string>();\n""",
    """  private consumedPublishedPlans = new Set<string>();\n  private summaryCache = new Map<string, Promise<import(\"./contracts\").SummaryStats>>();\n  private tableCache = new Map<string, Promise<ActivityListItem[]>>();\n  private metadataCache = new Map<string, Promise<import(\"./contracts\").RouteMetadata | null>>();\n""",
)
replace(
    "apps/web/src/engine.ts",
    """    this.consumedPublishedPlans.clear();\n    clearRenderPlanHints();\n""",
    """    this.consumedPublishedPlans.clear();\n    this.summaryCache.clear();\n    this.tableCache.clear();\n    this.metadataCache.clear();\n    clearRenderPlanHints();\n""",
)
replace(
    "apps/web/src/engine.ts",
    """    this.selectionKey = `${this.datasetRevision}|${this.clean ? 1 : 0}|${sql}`;\n    activateRenderTab(tab.id);\n""",
    """    this.selectionKey = `${this.datasetRevision}|${this.clean ? 1 : 0}|${sql}`;\n    this.summaryCache.clear();\n    this.tableCache.clear();\n    activateRenderTab(tab.id);\n""",
)
replace(
    "apps/web/src/engine.ts",
    """  getSummary(bounds?: ViewportBounds): Promise<import(\"./contracts\").SummaryStats> {\n    return this.networkRequest({ type: \"summary\", bounds, clean: this.clean });\n  }\n\n  getActivities(bounds?: ViewportBounds): Promise<ActivityListItem[]> {\n    return this.networkRequest({ type: \"table\", bounds, clean: this.clean });\n  }\n\n  getRouteMetadata(activityId: string): Promise<import(\"./contracts\").RouteMetadata | null> {\n    return this.networkRequest({ type: \"metadata\", activityId, clean: this.clean });\n  }\n""",
    """  getSummary(bounds?: ViewportBounds): Promise<import(\"./contracts\").SummaryStats> {\n    const key = `${this.selectionKey}|${bounds?.join(\",\") ?? \"all\"}`;\n    const cached = this.summaryCache.get(key);\n    if (cached) return cached;\n    const request = this.networkRequest<import(\"./contracts\").SummaryStats>({ type: \"summary\", bounds, clean: this.clean });\n    this.summaryCache.set(key, request);\n    request.catch(() => this.summaryCache.delete(key));\n    return request;\n  }\n\n  getActivities(bounds?: ViewportBounds): Promise<ActivityListItem[]> {\n    const key = `${this.selectionKey}|${bounds?.join(\",\") ?? \"all\"}`;\n    const cached = this.tableCache.get(key);\n    if (cached) return cached;\n    const request = this.networkRequest<ActivityListItem[]>({ type: \"table\", bounds, clean: this.clean });\n    this.tableCache.set(key, request);\n    request.catch(() => this.tableCache.delete(key));\n    return request;\n  }\n\n  getRouteMetadata(activityId: string): Promise<import(\"./contracts\").RouteMetadata | null> {\n    const key = `${this.datasetRevision}|${this.clean ? 1 : 0}|${activityId}`;\n    const cached = this.metadataCache.get(key);\n    if (cached) return cached;\n    const request = this.networkRequest<import(\"./contracts\").RouteMetadata | null>({ type: \"metadata\", activityId, clean: this.clean });\n    this.metadataCache.set(key, request);\n    request.catch(() => this.metadataCache.delete(key));\n    return request;\n  }\n""",
)
