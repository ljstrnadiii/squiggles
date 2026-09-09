import type { Lod } from "./lod";

export const ACTIVITY_SAMPLE_BUCKETS = 1024;
export const ACTIVITY_SAMPLE_LOD_BOOST = 2;
const ACTIVITY_SAMPLE_HEADROOM = 0.9;

export function boostedSampleLod(
  available: readonly Lod[],
  budgetLod: Lod,
  fidelityLod: Lod,
  steps = ACTIVITY_SAMPLE_LOD_BOOST,
): Lod {
  let result = budgetLod;
  for (let step = 0; step < steps; step += 1) {
    const next = available.find((level) => level > result && level <= fidelityLod);
    if (next == null) break;
    result = next;
  }
  return result;
}

export function activitySampleThreshold(vertexEstimate: number, vertexBudget: number): number {
  if (!Number.isFinite(vertexEstimate) || vertexEstimate <= 0 || vertexEstimate <= vertexBudget) {
    return ACTIVITY_SAMPLE_BUCKETS;
  }
  const target = vertexBudget * ACTIVITY_SAMPLE_HEADROOM;
  return Math.max(
    1,
    Math.min(
      ACTIVITY_SAMPLE_BUCKETS,
      Math.floor((target / vertexEstimate) * ACTIVITY_SAMPLE_BUCKETS),
    ),
  );
}

export function activitySampleFraction(threshold: number): number {
  return Math.max(0, Math.min(1, threshold / ACTIVITY_SAMPLE_BUCKETS));
}

export function activitySamplePredicate(alias: string, threshold: number): string {
  if (threshold >= ACTIVITY_SAMPLE_BUCKETS) return "TRUE";
  return `hash(${alias}.activity_id) % ${ACTIVITY_SAMPLE_BUCKETS} < ${threshold}`;
}
