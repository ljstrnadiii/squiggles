import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("query tab camera persistence", () => {
  it("persists the live camera for the tab being left before switching tabs", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    const choose = app.slice(app.indexOf("function choose("), app.indexOf("function add()"));

    expect(choose).toContain("setTabs(previous => {");
    expect(choose).toContain("item.id === tab.id ? { ...item, mapState: { ...view } } : item");
    expect(choose).toContain("saveTabs(updated);");
    expect(choose.indexOf("setTabs(previous => {")).toBeLessThan(choose.indexOf("setActive(next.id)"));
  });

  it("still snapshots the active live camera directly when publishing", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    const publish = app.slice(app.indexOf("async function publishTabs()"), app.indexOf("async function toggleStats()"));

    expect(publish).toContain("item.id === tab.id ? { ...item, mapState: view, sql: draft } : item");
  });
});
