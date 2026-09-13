import { beforeEach, describe, expect, it, vi } from "vitest";

import { likeMap, loadMapNavigation, rememberLocalMap, unlikeMap } from "./mapIdentity";

describe("map identity navigation", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("does not remember maps merely because they were opened", () => {
    const setItem = vi.spyOn(localStorage, "setItem");
    rememberLocalMap({ mapId: "31ea1577-b6f1-423a-8bda-ea7712345678", ownerDisplayName: "Martha", viewerRole: "viewer" });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("loads only server-backed Favorites navigation", async () => {
    const payload = { myMap: null, recentMaps: [{ mapId: "31ea1577-b6f1-423a-8bda-ea7712345678", ownerDisplayName: "Martha", viewerRole: "viewer", url: "/m/31ea1577-b6f1-423a-8bda-ea7712345678", lastViewedAt: "2026-09-12T12:00:00Z" }] };
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    const result = await loadMapNavigation({ apiUrl: "https://api.example.test", cognitoDomain: "", cognitoClientId: "" }, { accessToken: "access", idToken: "id" });
    expect(result).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("likes and unlikes a map explicitly", async () => {
    const mapId = "31ea1577-b6f1-423a-8bda-ea7712345678";
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: false }), { status: 200 }));
    const config = { apiUrl: "https://api.example.test", cognitoDomain: "", cognitoClientId: "" };
    const session = { accessToken: "access", idToken: "id" };
    await likeMap(config, session, mapId);
    await unlikeMap(config, session, mapId);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ mapId, favorite: true });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ mapId, favorite: true, remove: true });
  });
});
