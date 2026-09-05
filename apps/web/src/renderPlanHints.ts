import type { ResolutionRenderPlans, ViewportBounds } from "./contracts";

export type RenderPlanHint = {
  plans: ResolutionRenderPlans;
  bounds?: ViewportBounds;
};

const hints = new Map<string, RenderPlanHint>();
let activeTabId: string | null = null;

export function activateRenderTab(tabId: string) {
  activeTabId = tabId;
}

export function recordRenderPlan(tabId: string, hint: RenderPlanHint) {
  hints.set(tabId, hint);
}

export function recordActiveRenderPlan(hint: RenderPlanHint) {
  if (activeTabId) hints.set(activeTabId, hint);
}

export function renderPlanHint(tabId: string): RenderPlanHint | undefined {
  return hints.get(tabId);
}

export function clearRenderPlanHints() {
  hints.clear();
  activeTabId = null;
}
