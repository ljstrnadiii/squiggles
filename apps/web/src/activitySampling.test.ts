import { describe, expect, it } from "vitest";

import { boostedSampleLod } from "./activitySampling";

describe("activity sampling", () => {
  it("boosts the budget-selected overview toward the requested fidelity", () => {
    expect(boostedSampleLod([0, 1, 2, 3, 4, 5, 6, 7], 2, 6)).toBe(4);
    expect(boostedSampleLod([0, 2, 4, 6], 2, 6)).toBe(6);
    expect(boostedSampleLod([0, 2, 4, 6], 4, 4)).toBe(4);
  });
});
