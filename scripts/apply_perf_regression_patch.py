from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise RuntimeError(f"missing expected text in {path}: {old[:80]!r}")
    file.write_text(text.replace(old, new))


replace(
    "apps/web/src/App.test.tsx",
    "const engineCalls = vi.hoisted(() => ({ execute: vi.fn() }));\n",
    "const engineCalls = vi.hoisted(() => ({ execute: vi.fn(), getSummary: vi.fn() }));\n",
)
replace(
    "apps/web/src/App.test.tsx",
    "    async getSummary() { return { activityCount: 1, distanceM: 5000, elapsedSeconds: 2100, movingSeconds: 1800, elevationGainM: 100, elevationLossM: 90, minElevationM: 1400, maxElevationM: 1600, maxDistanceM: 5000, activeDays: 1, droppedJumpPoints: 1, droppedElevationPoints: 2, sportCounts: [{ sport: \"ride\", count: 1 }], firstActivity: \"2025-01-01\", lastActivity: \"2025-01-01\" }; }\n",
    "    async getSummary() { engineCalls.getSummary(); return { activityCount: 1, distanceM: 5000, elapsedSeconds: 2100, movingSeconds: 1800, elevationGainM: 100, elevationLossM: 90, minElevationM: 1400, maxElevationM: 1600, maxDistanceM: 5000, activeDays: 1, droppedJumpPoints: 1, droppedElevationPoints: 2, sportCounts: [{ sport: \"ride\", count: 1 }], firstActivity: \"2025-01-01\", lastActivity: \"2025-01-01\" }; }\n",
)
replace(
    "apps/web/src/App.test.tsx",
    "afterEach(() => { cleanup(); localStorage.clear(); engineCalls.execute.mockClear(); });\n",
    "afterEach(() => { cleanup(); localStorage.clear(); engineCalls.execute.mockClear(); engineCalls.getSummary.mockClear(); });\n",
)
replace(
    "apps/web/src/App.test.tsx",
    "    expect(await screen.findByRole(\"status\", { name: \"1 routes selected\" })).toBeInTheDocument();\n    openQueryMenu();\n    fireEvent.click(screen.getByRole(\"button\", { name: \"Rendering\" }));\n",
    "    expect(await screen.findByRole(\"status\", { name: \"1 routes selected\" })).toBeInTheDocument();\n    expect(engineCalls.getSummary).not.toHaveBeenCalled();\n    openQueryMenu();\n    fireEvent.click(screen.getByRole(\"button\", { name: \"Rendering\" }));\n",
)
replace(
    "apps/web/src/App.test.tsx",
    "    fireEvent.click(screen.getByRole(\"button\", { name: \"Statistics\" }));\n    expect(screen.getByRole(\"region\", { name: \"Detailed selection statistics\" })).toBeInTheDocument();\n",
    "    fireEvent.click(screen.getByRole(\"button\", { name: \"Statistics\" }));\n    await waitFor(() => expect(engineCalls.getSummary).toHaveBeenCalledTimes(1));\n    expect(screen.getByRole(\"region\", { name: \"Detailed selection statistics\" })).toBeInTheDocument();\n",
)

Path("apps/web/src/storage.performance.test.ts").write_text(
    '''import { describe, expect, it } from "vitest";\n\nimport { highRunsTab } from "./storage";\n\ndescribe("high elevation query", () => {\n  it("uses metadata-only maximum elevation", () => {\n    expect(highRunsTab.sql).toContain("max_elevation_m >= 3657.6");\n    expect(highRunsTab.sql).not.toContain("track_points");\n  });\n});\n'''
)
