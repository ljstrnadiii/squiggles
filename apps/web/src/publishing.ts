import { normalizeCamera } from "./camera";
import { authFetch, type AuthSession, type RuntimeConfig } from "./auth";
import type { QueryTab } from "./contracts";
import { renderPlanHint } from "./renderPlanHints";
import { defaultTab, normalizeTab } from "./storage";
import type { MapIdentity } from "./mapIdentity";

export type PublishedView = {
  slug?: string;
  mapId: string;
  url: string;
  tabs: QueryTab[];
  active: string;
  datasetId: string | null;
  updatedAt: string;
  identity: MapIdentity;
};

export async function publishView(
  config: RuntimeConfig,
  session: AuthSession,
  tabs: QueryTab[],
  active: string,
  datasetId: string | null,
) {
  const canonicalTabs = tabs.map((tab) => {
    const hint = renderPlanHint(tab.id);
    return {
      ...tab,
      ...(hint ? { startingPlans: hint.plans, startingBounds: hint.bounds } : {}),
      mapState: normalizeCamera(tab.mapState),
    };
  });

  const response = await authFetch(config, session, `${config.apiUrl}/api/published`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tabs: canonicalTabs, active, datasetId }),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? "Your account must be approved before saving views."
        : "Could not save this map view.",
    );
  }
  return response.json() as Promise<{ mapId: string; slug?: string; url: string }>;
}

export async function loadPublishedView(
  config: RuntimeConfig,
  mapRef: string,
): Promise<PublishedView> {
  const response = await fetch(`${config.apiUrl}/api/published/${mapRef}`, { cache: "no-store" });
  if (!response.ok) throw new Error("This map could not be found.");
  const saved = (await response.json()) as Partial<PublishedView> & Pick<PublishedView, "datasetId" | "updatedAt" | "identity">;
  const tabs = Array.isArray(saved.tabs) && saved.tabs.length ? saved.tabs.map(tab => normalizeTab(tab)) : [{ ...defaultTab, style: { ...defaultTab.style }, mapState: { ...defaultTab.mapState } }];
  const active = typeof saved.active === "string" && tabs.some(tab => tab.id === saved.active) ? saved.active : tabs[0].id;
  const mapId = saved.mapId ?? saved.identity.mapId;
  return {
    ...saved,
    mapId,
    url: saved.url ?? `/m/${mapId}`,
    tabs,
    active,
    datasetId: saved.datasetId ?? null,
    updatedAt: saved.updatedAt,
    identity: saved.identity,
  };
}
