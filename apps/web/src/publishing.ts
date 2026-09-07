import { authFetch, type AuthSession, type RuntimeConfig } from "./auth";
import type { QueryTab } from "./contracts";
import { renderPlanHint } from "./renderPlanHints";

export type PublishedView = {
  slug: string;
  tabs: QueryTab[];
  active: string;
  datasetId: string | null;
  updatedAt: string;
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
      mapState: {
        longitude: tab.mapState.longitude,
        latitude: tab.mapState.latitude,
        zoom: tab.mapState.zoom,
        bearing: tab.mapState.bearing,
        pitch: tab.mapState.pitch,
      },
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
        ? "Your account must be approved before publishing."
        : "Could not publish this map.",
    );
  }
  return response.json() as Promise<{ slug: string; url: string }>;
}

export async function loadPublishedView(
  config: RuntimeConfig,
  slug: string,
): Promise<PublishedView> {
  const response = await fetch(`${config.apiUrl}/api/published/${slug}`, { cache: "no-store" });
  if (!response.ok) throw new Error("This published map could not be found.");
  const published = (await response.json()) as PublishedView;
  return {
    ...published,
    tabs: published.tabs.map((tab) => ({
      ...tab,
      style: {
        ...tab.style,
        basemap: (tab.style.basemap as string) === "mapbox-satellite-clean" ? "mapbox-satellite" : tab.style.basemap,
        basemapOptions: { labels: false, roads: false, trails: false, boundaries: false, objects3d: false, ...tab.style.basemapOptions },
        viewMode: tab.style.viewMode ?? ((tab.mapState.pitch ?? 0) > 0 ? "3d" : "2d"),
      },
      mapState: {
        longitude: tab.mapState.longitude,
        latitude: tab.mapState.latitude,
        zoom: tab.mapState.zoom,
        bearing: Number.isFinite(tab.mapState.bearing) ? tab.mapState.bearing : 0,
        pitch: Number.isFinite(tab.mapState.pitch) ? tab.mapState.pitch : 0,
      },
    })),
  };
}
