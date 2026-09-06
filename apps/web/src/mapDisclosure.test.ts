import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("saved map disclosure navigation", () => {
  const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
  const main = readFileSync(join(process.cwd(), "src/main.tsx"), "utf8");
  const css = readFileSync(join(process.cwd(), "src/mapDisclosure.css"), "utf8");

  it("keeps query, stats, and table as per-map tools instead of global workspace modes", () => {
    expect(app).toContain("Query settings");
    expect(app).toContain("Statistics");
    expect(app).toContain(">Table</button>");
    expect(app).not.toContain('aria-label="View mode"');
  });

  it("labels the saved-query navigation as maps with disclosure carets", () => {
    expect(main).toContain('import "./mapDisclosure.css"');
    expect(css).toContain('content: "MAPS"');
    expect(css).toContain('content: "CURRENT MAP"');
    expect(css).toContain('content: "›"');
    expect(css).toContain('content: "⌄"');
  });

  it("stacks the map list and its tools on narrow screens", () => {
    expect(css).toContain("@media (max-width: 600px)");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
  });
});
