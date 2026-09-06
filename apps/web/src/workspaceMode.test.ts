import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("workspace modes", () => {
  const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");

  it("exposes the four primary modes", () => {
    expect(app).toContain('aria-label="View mode"');
    expect(app).toContain(">Map</button>");
    expect(app).toContain(">Query</button>");
    expect(app).toContain(">Stats</button>");
    expect(app).toContain(">Table</button>");
  });

  it("does not close query, stats, or table on an ordinary tab switch", () => {
    const choose = app.slice(app.indexOf("function choose("), app.indexOf("function add()"));
    const ordinarySwitch = choose.slice(0, choose.indexOf("if (openQuery)"));
    expect(ordinarySwitch).not.toContain("setStatsOpen(false)");
    expect(ordinarySwitch).not.toContain("setTableOpen(false)");
    expect(ordinarySwitch).not.toContain("setToolbarOpen(false)");
    expect(choose).toContain("if (openQuery)");
    expect(choose).toContain("setToolbarOpen(true)");
  });

  it("refreshes an open stats or table panel after a selection run", () => {
    const run = app.slice(app.indexOf("async function run("), app.indexOf("async function openSource("));
    expect(run).toContain("if (!viewportScope && statsOpen)");
    expect(run).toContain("engine.getSummary()");
    expect(run).toContain("else if (!viewportScope && tableOpen)");
    expect(run).toContain("engine.getActivities()");
  });
});
