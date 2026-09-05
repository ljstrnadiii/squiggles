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
      ...(hint
        ? {
            startingLod: hint.lod,
            startingVertexEstimate: hint.vertexEstimate,
            startingBounds: hint.bounds,
          }
        : {}),
      mapState: {
        longitude: tab.mapState.longitude,
        latitude: tab.mapState.latitude,
        zoom: tab.mapState.zoom,
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
      mapState: {
        longitude: tab.mapState.longitude,
        latitude: tab.mapState.latitude,
        zoom: tab.mapState.zoom,
      },
    })),
  };
}
