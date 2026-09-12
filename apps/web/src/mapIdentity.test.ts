import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocalMaps, loadMapNavigation, rememberLocalMap } from "./mapIdentity";

describe("map identity navigation", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("keeps only maps that were explicitly opened", () => {
    const marthaMapId = "31ea1577-b6f1-423a-8bda-ea7712345678";
    const alexMapId = "41ea1577-b6f1-423a-8bda-ea7712345678";
    rememberLocalMap({ mapId: marthaMapId, ownerDisplayName: "Martha", viewerRole: "viewer" }, "/p/abcd1234");
    rememberLocalMap({ mapId: alexMapId, ownerDisplayName: "Alex", viewerRole: "viewer" }, "/not-a-map");
    expect(loadLocalMaps()).toMatchObject([{ mapId: marthaMapId, ownerDisplayName: "Martha", url: `/m/${marthaMapId}` }]);
  });

  it("merges logged-out maps into authenticated recents by stable map id", async () => {
    const mapId = "31ea1577-b6f1-423a-8bda-ea7712345678";
    rememberLocalMap({ mapId, ownerDisplayName: "Martha", viewerRole: "viewer" }, "/p/abcd1234");
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ myMap: null, recentMaps: [] }), { status: 200 }));
    await loadMapNavigation({ apiUrl: "https://api.example.test", cognitoDomain: "", cognitoClientId: "" }, { accessToken: "access", idToken: "id" });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ mapId });
    expect(loadLocalMaps()).toEqual([]);
  });
});