import { authFetch, type AuthSession, type RuntimeConfig } from "./auth";

export type MapIdentity = {
  mapId: string;
  ownerDisplayName: string;
  ownerAvatarUrl?: string;
  viewerRole: "owner" | "viewer" | "admin";
};

export type FavoriteMap = MapIdentity & { url: string; lastViewedAt: string };
// Keep this alias while App still consumes the historical field name internally.
export type RecentMap = FavoriteMap;
export type MapNavigation = { myMap: (MapIdentity & { url: string }) | null; recentMaps: FavoriteMap[] };

export function canonicalMapUrl(identity: MapIdentity) {
  return `/m/${identity.mapId}`;
}

// Visiting a map no longer mutates navigation state. Maps only enter Favorites through an explicit Like.
export function rememberLocalMap(_identity: MapIdentity, _url = canonicalMapUrl(_identity)) {}

export async function loadMapNavigation(config: RuntimeConfig, session: AuthSession): Promise<MapNavigation> {
  const response = await authFetch(config, session, `${config.apiUrl}/api/recent-maps`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load favorites.");
  return response.json() as Promise<MapNavigation>;
}

export async function likeMap(config: RuntimeConfig, session: AuthSession, mapId: string) {
  const response = await authFetch(config, session, `${config.apiUrl}/api/recent-maps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mapId, favorite: true }),
  });
  if (!response.ok) throw new Error("Could not add this map to Favorites.");
}

export async function unlikeMap(config: RuntimeConfig, session: AuthSession, mapId: string) {
  const response = await authFetch(config, session, `${config.apiUrl}/api/recent-maps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mapId, favorite: true, remove: true }),
  });
  if (!response.ok) throw new Error("Could not remove this map from Favorites.");
}
