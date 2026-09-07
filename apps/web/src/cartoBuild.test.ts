import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");
const viteConfig = readFileSync(join(webRoot, "vite.config.ts"), "utf8");
const workflow = readFileSync(resolve(webRoot, "../../.github/workflows/ci.yml"), "utf8");

describe("CARTO basemap build wiring", () => {
  it("adds the configured API key to both CARTO raster tile templates", () => {
    expect(viteConfig).toContain("process.env.VITE_CARTO_API_KEY?.trim()");
    expect(viteConfig).toContain("light_all/{z}/{x}/{y}.png");
    expect(viteConfig).toContain("dark_all/{z}/{x}/{y}.png");
    expect(viteConfig).toContain("`${url}?key=${key}`");
  });

  it("exposes the GitHub secret only to the production web build", () => {
    expect(workflow).toContain("VITE_CARTO_API_KEY: ${{ secrets.VITE_CARTO_API_KEY }}");
  });
});
