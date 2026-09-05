import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("DuckDB worker startup", () => {
  it("does not install or load the spatial extension on startup", () => {
    const workerPath = fileURLToPath(new URL("./duckdb.worker.ts", import.meta.url));
    const source = readFileSync(workerPath, "utf8");

    expect(source).not.toContain("INSTALL spatial");
    expect(source).not.toContain("LOAD spatial");
  });
});
