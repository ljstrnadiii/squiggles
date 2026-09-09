export type HeatSampleActivity = {
  activityId: string;
  vertexCount: number;
  heatScore: number;
};

/**
 * Keep as much geometry as possible while preferentially dropping routes whose
 * existing heat score says they add the least new screen-space information.
 * Lower-heat routes survive longest. Stable activity-id ordering breaks ties so
 * the retained set does not flicker between equivalent renders.
 */
export function heatBudgetActivityIds(
  activities: readonly HeatSampleActivity[],
  vertexBudget: number,
): Set<string> {
  const total = activities.reduce((sum, activity) => sum + Math.max(0, activity.vertexCount), 0);
  if (total <= vertexBudget) return new Set(activities.map((activity) => activity.activityId));

  const ranked = [...activities].sort((left, right) =>
    left.heatScore - right.heatScore || left.activityId.localeCompare(right.activityId),
  );
  const kept = new Set<string>();
  let vertices = 0;
  for (const activity of ranked) {
    const next = Math.max(0, activity.vertexCount);
    if (vertices + next > vertexBudget && kept.size > 0) continue;
    kept.add(activity.activityId);
    vertices += next;
  }
  return kept;
}
