import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadPublishedView, publishView } from "./publishing";
import { clearRenderPlanHints, recordRenderPlan } from "./renderPlanHints";
import { defaultTab } from "./storage";

describe("saved map views", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearRenderPlanHints();
  });

  it("persists tabs without system settings", async () => {
    const mapId = "31ea1577-b6f1-423a-8bda-ea7712345678";
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ mapId, slug: "abcd1234", url: `/m/${mapId}` }), {
        status: 200,
      }),
    );
    const terrainTab = { ...defaultTab, mapState: { ...defaultTab.mapState, pitch: 47, bearing: -31 }, style: { ...defaultTab.style, viewMode: "3d" as const } };
    const result = await publishView(
      { apiUrl: "https://api.example.com", cognitoDomain: "", cognitoClientId: "" },
      { accessToken: "access", idToken: "id" },
      [terrainTab],
      "all",
      null,
    );
    const request = fetcher.mock.calls[0][1]!;
    expect(JSON.parse(String(request.body))).toMatchObject({ active: "all", datasetId: null });
    expect(String(request.body)).not.toContain("theme");
    expect(String(request.body)).not.toContain("units");
    expect(JSON.parse(String(request.body)).tabs[0].mapState).toEqual(terrainTab.mapState);
    expect(result.url).toBe(`/m/${mapId}`);
  });

  it("persists low medium and high render plans with their source viewport", async () => {
    const bounds: [number, number, number, number] = [-105.4, 39.9, -105.1, 40.2];
    const plans = {
      low: { lod: 3 as const, vertexEstimate: 700_000 },
      medium: { lod: 4 as const, vertexEstimate: 1_100_000 },
      high: { lod: 5 as const, vertexEstimate: 1_600_000 },
    };
    recordRenderPlan(defaultTab.id, { plans, bounds });
    const mapId = "31ea1577-b6f1-423a-8bda-ea7712345678";
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ mapId, slug: "abcd1234", url: `/m/${mapId}` }), {
        status: 200,
      }),
    );
    await publishView(
      { apiUrl: "https://api.example.com", cognitoDomain: "", cognitoClientId: "" },
      { accessToken: "access", idToken: "id" },
      [defaultTab],
      defaultTab.id,
      null,
    );
    const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    expect(body.tabs[0]).toMatchObject({
      startingPlans: plans,
      startingBounds: bounds,
    });
  });

  it("loads a legacy published alias as its canonical map", async () => {
    const mapId = "31ea1577-b6f1-423a-8bda-ea7712345678";
    const dirty = {
      ...defaultTab,
      mapState: {
        ...defaultTab.mapState,
        pitch: 47,
        bearing: -31,
        width: 1440,
        maxBounds: [
          [null, -90],
          [null, 90],
        ],
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          slug: "abcd1234",
          mapId,
          url: `/m/${mapId}`,
          tabs: [dirty],
          active: "all",
          datasetId: null,
          updatedAt: "2026-08-24",
          identity: { mapId, ownerDisplayName: "Martha", viewerRole: "viewer" },
        }),
        { status: 200 },
      ),
    );
    const published = await loadPublishedView(
      { apiUrl: "https://api.example.com", cognitoDomain: "", cognitoClientId: "" },
      "abcd1234",
    );
    expect(published.mapId).toBe(mapId);
    expect(published.url).toBe(`/m/${mapId}`);
    expect(published.active).toBe("all");
    expect(published.tabs[0].mapState).toEqual({ ...defaultTab.mapState, pitch: 47, bearing: -31 });
  });
});