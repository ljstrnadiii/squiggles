import { authFetch, type AuthSession, type RuntimeConfig } from "./auth";

export type MapIdentity = {
  mapId: string;
  ownerDisplayName: string;
  ownerAvatarUrl?: string;
  viewerRole: "owner" | "viewer" | "admin";
};

export type RecentMap = MapIdentity & { url: string; lastViewedAt: string };
export type MapNavigation = { myMap: (MapIdentity & { url: string }) | null; recentMaps: RecentMap[] };

const localKey = "squiggles-recent-maps.v1";

export function rememberLocalMap(identity: MapIdentity, url: string) {
  if (!/^\/p\/[a-z0-9]{8}$/.test(url)) return;
  const current = loadLocalMaps().filter(item => item.url !== url);
  localStorage.setItem(localKey, JSON.stringify([{ ...identity, url, lastViewedAt: new Date().toISOString() }, ...current].slice(0, 8)));
}

export function loadLocalMaps(): RecentMap[] {
  try {
    const maps = JSON.parse(localStorage.getItem(localKey) ?? "[]") as RecentMap[];
    return Array.isArray(maps) ? maps.filter(item => /^\/p\/[a-z0-9]{8}$/.test(item.url)) : [];
  } catch {
    return [];
  }
}

export async function loadMapNavigation(config: RuntimeConfig, session: AuthSession): Promise<MapNavigation> {
  const localMaps = loadLocalMaps();
  const saved = new Set<string>();
  await Promise.all(localMaps.map(async map => {
    const slug = map.url.split("/").at(-1)!;
    const response = await authFetch(config, session, `${config.apiUrl}/api/recent-maps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    if (response.ok || response.status === 404) saved.add(map.url);
  }));
  const remaining = localMaps.filter(map => !saved.has(map.url));
  if (remaining.length) localStorage.setItem(localKey, JSON.stringify(remaining));
  else localStorage.removeItem(localKey);

  const response = await authFetch(config, session, `${config.apiUrl}/api/recent-maps`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load recent maps.");
  return response.json() as Promise<MapNavigation>;
}
