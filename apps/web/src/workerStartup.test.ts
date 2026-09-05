import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("DuckDB worker startup", () => {
  it("does not install or load the spatial extension on startup", () => {
    const source = readFileSync(join(process.cwd(), "src/duckdb.worker.ts"), "utf8");

    // Keep startup free of unused extension installation/loading work.
    expect(source).not.toContain("INSTALL spatial");
    expect(source).not.toContain("LOAD spatial");
  });
});
