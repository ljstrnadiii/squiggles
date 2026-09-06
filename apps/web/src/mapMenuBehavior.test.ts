import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("saved map menu behavior", () => {
  const enhancements = readFileSync(join(process.cwd(), "src/PanelEnhancements.tsx"), "utf8");

  it("keeps the picker available after switching to a different map", () => {
    expect(enhancements).toContain("keepPickerOpenAfterMapSwitch");
    expect(enhancements).toContain('button.classList.contains("active")');
    expect(enhancements).toContain('button.textContent?.trim() === "New query"');
    expect(enhancements).toContain('title?.getAttribute("aria-expanded") === "false"');
    expect(enhancements).toContain("title.click()");
  });

  it("moves rendering out of the current-map tools and into the Squiggles menu", () => {
    expect(enhancements).toContain('const rendering = queryMenuButton("Rendering")');
    expect(enhancements).toContain("rendering.hidden = true");
    expect(enhancements).toContain("<button onClick={openRenderingDiagnostics}>Rendering</button>");
    expect(enhancements).toContain('queryMenuButton("Rendering")?.click()');
  });
});
