import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocalMaps, loadMapNavigation, rememberLocalMap } from "./mapIdentity";

describe("map identity navigation", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("keeps only maps that were explicitly opened", () => {
    rememberLocalMap({ mapId: "map-1", ownerDisplayName: "Martha", viewerRole: "viewer" }, "/p/abcd1234");
    rememberLocalMap({ mapId: "map-2", ownerDisplayName: "Alex", viewerRole: "viewer" }, "/not-a-map");
    expect(loadLocalMaps()).toMatchObject([{ mapId: "map-1", ownerDisplayName: "Martha", url: "/p/abcd1234" }]);
  });

  it("merges logged-out maps into authenticated recents", async () => {
    rememberLocalMap({ mapId: "map-1", ownerDisplayName: "Martha", viewerRole: "viewer" }, "/p/abcd1234");
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ myMap: null, recentMaps: [] }), { status: 200 }));
    await loadMapNavigation({ apiUrl: "https://api.example.test", cognitoDomain: "", cognitoClientId: "" }, { accessToken: "access", idToken: "id" });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ slug: "abcd1234" });
    expect(loadLocalMaps()).toEqual([]);
  });
});
