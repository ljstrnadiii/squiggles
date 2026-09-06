import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "PanelEnhancements.tsx"), "utf8");
const disclosure = readFileSync(join(import.meta.dirname, "mapDisclosure.css"), "utf8");

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
});
