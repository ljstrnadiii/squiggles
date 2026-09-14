import { describe, expect, it } from "vitest";

import { legacyDatasetRedirect } from "./legacyRoute";

describe("legacy dataset route", () => {
  it("preserves startup camera and map settings when normalizing the path", () => {
    const search = "?lng=-105.2705&lat=40.0150&zoom=11&pitch=50&view=3d";
    expect(legacyDatasetRedirect("/m/97d948ec-47c1-435a-add9-65eee580fa49", search)).toBe(`/${search}`);
  });

  it("leaves normal routes untouched", () => {
    expect(legacyDatasetRedirect("/", "?zoom=11")).toBeNull();
    expect(legacyDatasetRedirect("/p/abc12345", "?zoom=11")).toBeNull();
  });
});
