import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const main = readFileSync(join(import.meta.dirname, "main.tsx"), "utf8");
const css = readFileSync(join(import.meta.dirname, "legacyViewMenuFix.css"), "utf8");

describe("legacy view menu compatibility", () => {
  it("keeps the native query menu hidden when the redesigned map navigation is mounted", () => {
    expect(main).toContain('import "./legacyViewMenuFix.css"');
    expect(css).toContain("body:has(.map-navigation-redesign-marker)");
    expect(css).toContain('nav.mobile-menu[aria-label="Query navigation"]');
    expect(css).toContain("display: none !important");
  });
});
