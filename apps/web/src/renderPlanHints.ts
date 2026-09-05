import type { RenderLod } from "./contracts";

export type RenderPlanHint = { lod: RenderLod; vertexEstimate: number };

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
