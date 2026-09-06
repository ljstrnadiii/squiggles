import { describe, expect, it } from "vitest";

import { highRunsTab } from "./storage";

describe("high elevation query", () => {
  it("uses metadata-only maximum elevation", () => {
    expect(highRunsTab.sql).toContain("max_elevation_m >= 3657.6");
    expect(highRunsTab.sql).not.toContain("track_points");
  });
});
