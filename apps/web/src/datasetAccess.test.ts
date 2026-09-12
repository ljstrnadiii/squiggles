import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadPrivateDataset, loadPublishedDataset } from "./datasetAccess";
import type { RuntimeConfig } from "./auth";

const config: RuntimeConfig = {
  apiUrl: "https://api.example.test",
  cognitoDomain: "https://auth.example.test",
  cognitoClientId: "client",
};

const manifest = {
  schema_version: "1.6.0",
  activity_count: 1,
  rejection_count: 0,
  bbox: [-105, 39, -104, 40],
  shards: [{ path: "activities/a.parquet", url: "https://s3.example.test/signed-a", row_count: 1, byte_size: 10, sha256: "a" }],
};

describe("dataset access", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens private datasets through the authorized access endpoint", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ datasetId: "dataset-1", manifest }), { status: 200 }),
    );

    const source = await loadPrivateDataset(config, { accessToken: "access", idToken: "id" }, "dataset-1");

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/api/datasets/dataset-1/access",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({ authorization: "Bearer access" }),
      }),
    );
    expect(source).toEqual({ kind: "url", baseUrl: "", name: "dataset-1", manifest });
  });

  it("opens published datasets through the public published access endpoint", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ datasetId: "dataset-1", manifest }), { status: 200 }),
    );

    const source = await loadPublishedDataset(config, "abcd1234");

    expect(fetcher).toHaveBeenCalledWith("https://api.example.test/api/published/abcd1234/dataset-access", { cache: "no-store" });
    expect(source).toEqual({ kind: "url", baseUrl: "", name: "dataset-1", manifest });
  });
});
