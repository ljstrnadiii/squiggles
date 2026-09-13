import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "PanelEnhancements.tsx"), "utf8");
const app = readFileSync(join(import.meta.dirname, "App.tsx"), "utf8");
const mapNavigation = readFileSync(join(import.meta.dirname, "MapNavigationEnhancements.tsx"), "utf8");
const panelCss = readFileSync(join(import.meta.dirname, "panelEnhancements.css"), "utf8");
const styles = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

describe("map navigation enhancements", () => {
  it("removes the legacy query dropdown instead of reopening or hiding it", () => {
    expect(source).not.toContain("reopenAfterSwitch");
    expect(source).not.toContain("queryMenu");
    expect(app).not.toContain("menuOpen");
    expect(app).not.toContain("mobile-query-title");
    expect(app).not.toContain('aria-label="Query navigation"');
    expect(mapNavigation).not.toContain("nativeQueryButton");
    expect(mapNavigation).not.toContain("chooseNativeMapView");
    expect(mapNavigation).toContain("selectMapView(view.id)");
  });

  it("keeps rendering metrics in the combined Diagnostics panel", () => {
    expect(source).toContain(">Copy</button>");
    expect(source).not.toContain("openRenderingDiagnostics");
    expect(source).not.toContain('button.textContent?.trim() === "Rendering"');
  });

  it("makes diagnostics, system settings, and activity detail replace each other on mobile", () => {
    expect(source).toContain('window.matchMedia?.("(max-width: 700px)")');
    expect(source).toContain('aside.detail[aria-label="Activity detail"]');
    expect(source).toContain('section.system-settings[aria-label="System settings"]');
    expect(source).toContain("if (isMobilePanelLayout()) closeActivityDetail()");
    expect(source).toContain("if (panels.systemSettings)");
    expect(source).toContain("if (panels.detail)");
    expect(source).toContain("setDiagnosticsOpen(false)");
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
