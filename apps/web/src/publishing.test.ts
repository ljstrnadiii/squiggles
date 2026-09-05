import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPublishedView, publishView } from "./publishing";
import { clearRenderPlanHints, recordRenderPlan } from "./renderPlanHints";
import { defaultTab } from "./storage";

describe("published maps", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearRenderPlanHints();
  });

  it("persists tabs without system settings", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ slug: "abcd1234", url: "/p/abcd1234" }), { status: 200 }));
    const result = await publishView({ apiUrl: "https://api.example.com", cognitoDomain: "", cognitoClientId: "" }, { accessToken: "access", idToken: "id" }, [defaultTab], "all", null);
    const request = fetcher.mock.calls[0][1]!;
    expect(JSON.parse(String(request.body))).toMatchObject({ active: "all", datasetId: null });
    expect(String(request.body)).not.toContain("theme");
    expect(String(request.body)).not.toContain("units");
    expect(JSON.parse(String(request.body)).tabs[0].mapState).toEqual(defaultTab.mapState);
    expect(result.url).toBe("/p/abcd1234");
  });

  it("persists the resolved render plan as a startup hint", async () => {
    recordRenderPlan(defaultTab.id, { lod: 4, vertexEstimate: 420_000 });
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ slug: "abcd1234", url: "/p/abcd1234" }), { status: 200 }));
    await publishView({ apiUrl: "https://api.example.com", cognitoDomain: "", cognitoClientId: "" }, { accessToken: "access", idToken: "id" }, [defaultTab], defaultTab.id, null);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    expect(body.tabs[0]).toMatchObject({ startingLod: 4, startingVertexEstimate: 420_000 });
  });

  it("loads a short published view", async () => {
    const dirty = { ...defaultTab, mapState: { ...defaultTab.mapState, width: 1440, maxBounds: [[null, -90], [null, 90]] } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ slug: "abcd1234", tabs: [dirty], active: "all", datasetId: null, updatedAt: "2026-08-24" }), { status: 200 }));
    const published = await loadPublishedView({ apiUrl: "https://api.example.com", cognitoDomain: "", cognitoClientId: "" }, "abcd1234");
    expect(published.active).toBe("all");
    expect(published.tabs[0].mapState).toEqual(defaultTab.mapState);
  });
});
