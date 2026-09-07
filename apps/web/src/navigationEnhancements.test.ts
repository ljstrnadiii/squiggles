import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "PanelEnhancements.tsx"), "utf8");
const disclosure = readFileSync(join(import.meta.dirname, "mapDisclosure.css"), "utf8");
const panelCss = readFileSync(join(import.meta.dirname, "panelEnhancements.css"), "utf8");

describe("map navigation enhancements", () => {
  it("keeps the map menu open after switching to another saved map", () => {
    expect(source).toContain("reopenAfterSwitch");
    expect(source).toContain('button.mobile-query-title');
    expect(source).toContain('getAttribute("aria-expanded") !== "true"');
    expect(source).toContain('button.addEventListener("click", reopenAfterSwitch)');
  });

  it("moves rendering out of current-map tools and into Diagnostics", () => {
    expect(disclosure).toContain(".mobile-menu section:nth-child(2) > button:nth-child(4)");
    expect(disclosure).toContain("display: none");
    expect(source).toContain("Rendering diagnostics");
    expect(source).toContain("openRenderingDiagnostics");
    expect(source).toContain('button.textContent?.trim() === "Rendering"');
  });

  it("anchors normal mobile query settings at the bottom and expanded settings to the full viewport", () => {
    expect(panelCss).toContain('section.toolbar[aria-label="Query and map settings"]:not([data-panel-expanded]) {\n    top: auto;');
    expect(panelCss).toContain('section.toolbar[aria-label="Query and map settings"][data-panel-expanded] {\n    top: 0;');
  });
});
