import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const engine = readFileSync(join(import.meta.dirname, "engine.ts"), "utf8");

describe("engine UI boundary", () => {
  it("does not discover viewport dimensions from the DOM", () => {
    expect(engine).not.toContain('document.querySelector<HTMLElement>("section.map")');
    expect(engine).not.toContain("private viewportSize(");
    expect(engine).toContain("viewportSize,");
  });
});
