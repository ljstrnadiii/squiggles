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

  it("does not close query, stats, or table when changing tabs", () => {
    const choose = app.slice(app.indexOf("function choose("), app.indexOf("function add()"));
    expect(choose).not.toContain("setStatsOpen(false)");
    expect(choose).not.toContain("setTableOpen(false)");
    expect(choose).not.toContain("setToolbarOpen(false)");
  });

  it("refreshes an open stats or table panel after a selection run", () => {
    const run = app.slice(app.indexOf("async function run("), app.indexOf("async function openSource("));
    expect(run).toContain("if (!viewportScope && statsOpen)");
    expect(run).toContain("engine.getSummary()");
    expect(run).toContain("else if (!viewportScope && tableOpen)");
    expect(run).toContain("engine.getActivities()");
  });
});
