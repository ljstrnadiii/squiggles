import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "PanelEnhancements.tsx"), "utf8");
const disclosure = readFileSync(join(import.meta.dirname, "mapDisclosure.css"), "utf8");
const panelCss = readFileSync(join(import.meta.dirname, "panelEnhancements.css"), "utf8");
const styles = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

describe("map navigation enhancements", () => {
  it("keeps the map menu open after switching to another saved map", () => {
    expect(source).toContain("reopenAfterSwitch");
    expect(source).toContain('button.mobile-query-title');
    expect(source).toContain('getAttribute("aria-expanded") !== "true"');
    expect(source).toContain('button.addEventListener("click", reopenAfterSwitch)');
  });

  it("keeps rendering metrics in the combined Diagnostics panel", () => {
    expect(disclosure).toContain(".mobile-menu section:nth-child(2) > button:nth-child(4)");
    expect(disclosure).toContain("display: none");
    expect(source).toContain(">Copy</button>");
    expect(source).not.toContain("openRenderingDiagnostics");
    expect(source).not.toContain('button.textContent?.trim() === "Rendering"');
  });

  it("anchors normal mobile query settings at the bottom", () => {
    expect(panelCss).toContain('section.toolbar[aria-label="Query and map settings"]:not([data-panel-expanded]) {\n    top: auto;');
  });

  it("keeps expanded query settings and table flush with the persistent top bar", () => {
    expect(panelCss).toContain('section.activity-table[aria-label="Activity table"][data-panel-expanded],\nsection.toolbar[aria-label="Query and map settings"][data-panel-expanded] {\n  top: 54px;');
    expect(panelCss).not.toContain('section.toolbar[aria-label="Query and map settings"][data-panel-expanded] {\n  top: 0;');
  });

  it("keeps desktop query settings, statistics, and table in the right-side drawer system", () => {
    expect(styles).toContain('.toolbar {\n  position: fixed;\n  z-index: 12;\n  top: 54px;\n  right: 0;\n  bottom: 0;');
    expect(styles).toContain('.rich-stats {\n  position: fixed;\n  z-index: 12;\n  top: 54px;\n  right: 0;\n  bottom: 0;');
    expect(styles).toContain('.activity-table {\n  position: fixed;\n  z-index: 12;\n  top: 54px;\n  right: 0;\n  bottom: 0;');
    expect(panelCss).not.toContain('section.rich-stats[aria-label="Detailed selection statistics"] {\n  top: 66px;');
    expect(panelCss).not.toContain('section.activity-table[aria-label="Activity table"]:not([data-panel-expanded]) {\n  top: 66px;');
  });
});
