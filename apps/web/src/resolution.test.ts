import { beforeEach, describe, expect, it } from "vitest";

import { defaultSystemResolution, loadSystemResolution, saveSystemResolution } from "./resolution";

describe("system resolution", () => {
  beforeEach(() => localStorage.clear());

  it("defaults coarse pointers to low and fine pointers to medium", () => {
    expect(defaultSystemResolution(true)).toBe("low");
    expect(defaultSystemResolution(false)).toBe("medium");
  });

  it("persists every explicit resolution tier", () => {
    for (const resolution of ["low", "medium", "high"] as const) {
      saveSystemResolution(resolution);
      expect(loadSystemResolution()).toBe(resolution);
    }
  });
});
