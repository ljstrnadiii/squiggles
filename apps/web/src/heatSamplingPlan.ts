import type { ViewportBounds } from "./contracts";

export type HeatSamplingPlan = {
  visibleBounds: ViewportBounds;
  fetchBounds: ViewportBounds;
};

/** Sampling decisions are always based on visibleBounds. fetchBounds may be
 * padded for cache/pan smoothness, but must never tighten the sample rate. */
export function heatSamplingPlan(
  visibleBounds: ViewportBounds,
  fetchBounds: ViewportBounds,
): HeatSamplingPlan {
  return { visibleBounds, fetchBounds };
}
