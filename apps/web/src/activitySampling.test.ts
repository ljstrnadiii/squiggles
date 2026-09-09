import { describe, expect, it } from "vitest";

import {
  ACTIVITY_SAMPLE_BUCKETS,
  activitySampleFraction,
  activitySamplePredicate,
  activitySampleThreshold,
  boostedSampleLod,
} from "./activitySampling";

describe("activity sampling", () => {
  it("boosts the budget-selected overview toward the requested fidelity", () => {
    expect(boostedSampleLod([0, 1, 2, 3, 4, 5, 6, 7], 2, 6)).toBe(4);
    expect(boostedSampleLod([0, 2, 4, 6], 2, 6)).toBe(6);
    expect(boostedSampleLod([0, 2, 4, 6], 4, 4)).toBe(4);
  });

  it("uses all activities when the finer overview already fits", () => {
    expect(activitySampleThreshold(900_000, 1_250_000)).toBe(ACTIVITY_SAMPLE_BUCKETS);
    expect(activitySampleFraction(ACTIVITY_SAMPLE_BUCKETS)).toBe(1);
    expect(activitySamplePredicate("a", ACTIVITY_SAMPLE_BUCKETS)).toBe("TRUE");
  });

  it("leaves headroom when sampling an over-budget overview", () => {
    const threshold = activitySampleThreshold(5_000_000, 1_250_000);
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBeLessThan(ACTIVITY_SAMPLE_BUCKETS);
    expect(activitySampleFraction(threshold)).toBeLessThan(0.25);
    expect(activitySamplePredicate("a", threshold)).toContain("hash(a.activity_id)");
  });

  it("produces nested bucket thresholds as the budget increases", () => {
    const low = activitySampleThreshold(5_000_000, 750_000);
    const medium = activitySampleThreshold(5_000_000, 1_250_000);
    const high = activitySampleThreshold(5_000_000, 1_750_000);
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });
});
