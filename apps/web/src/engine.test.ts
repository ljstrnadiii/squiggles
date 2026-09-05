import { describe, expect, it, vi } from "vitest";

import type { QueryTab, ViewportResult } from "./contracts";
import { BrowserDuckDBEngine, cacheBudget, formatDuckDBDiagnostic } from "./engine";
import { defaultTab } from "./storage";

const resolutionPlans = {
  low: { lod: 1 as const, vertexEstimate: 500_000 },
  medium: { lod: 2 as const, vertexEstimate: 900_000 },
  high: { lod: 2 as const, vertexEstimate: 900_000 },
};

const viewport = (): Omit<ViewportResult, "cache"> => ({
  batches: [
    {
      activities: [
        {
          activityId: "a",
          name: "A",
          sportType: "Run",
          startTime: null,
          distanceM: null,
          elevationGainM: null,
          maxElevationM: null,
          sourceUrl: null,
        },
      ],
      positions: new Float64Array([-105, 40, -104, 41]),
      startIndices: new Uint32Array([0, 2]),
      segmentActivityIndices: new Uint32Array([0]),
    },
  ],
  activityCount: 1,
  geometryBufferBytes: 32,
  lod: 2,
  vertexCount: 2,
  plannedVertexEstimate: 2,
  resolutionPlans,
  rawVertexEstimate: 2,
  vertexBudget: 1_250_000,
  scan: {
    candidateFragmentCount: 1,
    totalFragmentCount: 1,
    candidateBytes: 32,
    totalBytes: 32,
    expectedRowGroupCount: 1,
    candidateRowGroupCount: 1,
    totalRowGroupCount: 1,
    expectedRowCount: 1,
    keptRowCount: 1,
  },
});

function workerRecorder(posted: Record<string, unknown>[]) {
  return class WorkerMock {
    onmessage: ((event: MessageEvent) => void) | null = null;

    postMessage(message: { id: number } & Record<string, unknown>) {
      posted.push(message);
      queueMicrotask(() =>
        this.onmessage?.({ data: { id: message.id, ok: true, value: true } } as MessageEvent),
      );
    }
  };
}

function v3Manifest() {
  return {
    schema_version: "1.5.0",
    activity_count: 1,
    rejection_count: 0,
    bbox: [-105, 40, -104, 41],
    shards: [{ path: "activities/a.parquet", row_count: 1, byte_size: 10, sha256: "a" }],
    render_levels: [
      {
        lod: 0,
        tolerance_m: 2048,
        row_count: 1,
        byte_size: 5,
        bbox: [-105, 40, -104, 41],
        file_count: 1,
        row_group_count: 1,
        files: [
          {
            path: "render/lod=0/part-00000.parquet",
            row_count: 1,
            byte_size: 5,
            sha256: "b",
            bbox: [-105, 40, -104, 41],
            row_group_count: 1,
            row_groups: [
              {
                row_count: 1,
                bbox: [-105, 40, -104, 41],
                vertex_count: { sum: 2, min: 2, max: 2 },
                clean_vertex_count: { sum: 2, min: 2, max: 2 },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("BrowserDuckDBEngine viewport cache", () => {
  it("registers v3 render files separately from canonical shards", async () => {
    const posted: Record<string, unknown>[] = [];
    const originalWorker = globalThis.Worker;
    globalThis.Worker = workerRecorder(posted) as unknown as typeof Worker;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(v3Manifest())));

    const engine = new BrowserDuckDBEngine();
    await engine.openDataset({
      kind: "url",
      baseUrl: "https://example.test/dataset",
      name: "test",
    });

    expect(posted[0]).toMatchObject({
      type: "open",
      files: [
        {
          name: "activities/a.parquet",
          url: "https://example.test/dataset/activities/a.parquet",
        },
      ],
      renderLevels: [
        {
          lod: 0,
          files: [
            {
              name: "render/lod=0/part-00000.parquet",
              url: "https://example.test/dataset/render/lod=0/part-00000.parquet",
              rowGroups: [{ vertexSum: 2, cleanVertexSum: 2 }],
            },
          ],
        },
      ],
    });

    fetchMock.mockRestore();
    globalThis.Worker = originalWorker;
  });

  it("rejects stale render manifests instead of carrying compatibility code", async () => {
    const originalWorker = globalThis.Worker;
    globalThis.Worker = workerRecorder([]) as unknown as typeof Worker;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ...v3Manifest(),
          render_levels: [
            {
              lod: 0,
              path: "render/lod-0.parquet",
              row_count: 1,
              byte_size: 5,
              sha256: "b",
            },
          ],
        }),
      ),
    );

    const engine = new BrowserDuckDBEngine();
    await expect(
      engine.openDataset({
        kind: "url",
        baseUrl: "https://example.test/dataset",
        name: "test",
      }),
    ).rejects.toThrow("Dataset render format is stale");

    fetchMock.mockRestore();
    globalThis.Worker = originalWorker;
  });

  it("reuses the same transferred GeoArrow buffers for an identical viewport", async () => {
    const posted: unknown[] = [];
    class WorkerMock {
      onmessage: ((event: MessageEvent) => void) | null = null;

      postMessage(message: { id: number }) {
        posted.push(message);
        const value = {
          queryId: "1",
          summary: {},
          renderPlan: { type: "arrow", activityIds: ["a"] },
          ...viewport(),
        };
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: message.id, ok: true, value } } as MessageEvent),
        );
      }
    }

    const originalWorker = globalThis.Worker;
    globalThis.Worker = WorkerMock as unknown as typeof Worker;
    const engine = new BrowserDuckDBEngine();
    const tab: QueryTab = {
      ...defaultTab,
      style: { ...defaultTab.style },
      sql: "SELECT activity_id FROM activities",
    };
    const bounds: [number, number, number, number] = [-105.3, 39.9, -105.1, 40.1];
    const first = await engine.execute(tab, 12, bounds);
    const second = await engine.renderViewport(12, bounds);
    expect(posted).toHaveLength(1);
    expect(second.cache.hit).toBe(true);
    expect(second.batches[0].positions).toBe(first.batches[0].positions);
    expect(second.batches[0].positions.buffer).toBe(first.batches[0].positions.buffer);
    globalThis.Worker = originalWorker;
  });

  it("reuses a cached same-fidelity viewport when zooming into a contained area", async () => {
    const posted: unknown[] = [];
    class WorkerMock {
      onmessage: ((event: MessageEvent) => void) | null = null;

      postMessage(message: { id: number }) {
        posted.push(message);
        const value = {
          queryId: "1",
          summary: {},
          renderPlan: { type: "arrow", activityIds: ["a"] },
          ...viewport(),
        };
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: message.id, ok: true, value } } as MessageEvent),
        );
      }
    }

    const originalWorker = globalThis.Worker;
    globalThis.Worker = WorkerMock as unknown as typeof Worker;
    const engine = new BrowserDuckDBEngine();
    const tab: QueryTab = {
      ...defaultTab,
      style: { ...defaultTab.style },
      sql: "SELECT activity_id FROM activities",
    };
    await engine.execute(tab, 12.1, [-106, 39, -104, 41]);
    const result = await engine.renderViewport(12.4, [-105.5, 39.5, -104.5, 40.5]);
    expect(posted).toHaveLength(1);
    expect(result.cache.hit).toBe(true);
    globalThis.Worker = originalWorker;
  });

  it("lets resolution own the geometry cache budget", () => {
    expect(cacheBudget("low")).toBe(128 * 1024 ** 2);
    expect(cacheBudget("medium")).toBe(256 * 1024 ** 2);
    expect(cacheBudget("high")).toBe(512 * 1024 ** 2);
  });

  it("formats copyable DuckDB diagnostics without exposing file URLs", () => {
    const message = formatDuckDBDiagnostic(
      {
        type: "execute",
        sql: "SELECT activity_id FROM activities",
        lod: 2,
        resolution: "medium",
        bounds: [-105, 39, -104, 40],
        clean: false,
      },
      new Error("Invalid Error: stoi: no conversion"),
      {
        dataset: "archive",
        schemaVersion: "1.4.0",
        files: ["activities/a.parquet", "render/lod=2/part-00000.parquet"],
      },
    );
    expect(message).toContain("Squiggles DuckDB failure");
    expect(message).toContain("Request: execute");
    expect(message).toContain("Resolution: medium");
    expect(message).toContain("Schema: 1.4.0");
    expect(message).toContain("activities/a.parquet");
    expect(message).toContain("SELECT activity_id FROM activities");
    expect(message).toContain("stoi: no conversion");
    expect(message).not.toContain("https://");
  });

  it("retries a transient Parquet range-request failure", async () => {
    let attempts = 0;
    class WorkerMock {
      onmessage: ((event: MessageEvent) => void) | null = null;

      postMessage(message: { id: number }) {
        attempts += 1;
        const data =
          attempts === 1
            ? {
                id: message.id,
                ok: false,
                error: "NetworkError: XMLHttpRequest failed to load a Parquet range",
              }
            : {
                id: message.id,
                ok: true,
                value: {
                  queryId: "1",
                  summary: {},
                  renderPlan: { type: "arrow", activityIds: ["a"] },
                  ...viewport(),
                },
              };
        queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
      }
    }

    const originalWorker = globalThis.Worker;
    globalThis.Worker = WorkerMock as unknown as typeof Worker;
    const engine = new BrowserDuckDBEngine();
    const tab: QueryTab = {
      ...defaultTab,
      style: { ...defaultTab.style },
      sql: "SELECT activity_id FROM activities",
    };
    const result = await engine.execute(tab, 12, [-106, 39, -104, 41]);
    expect(attempts).toBe(2);
    expect(result.activityCount).toBe(1);
    globalThis.Worker = originalWorker;
  });
});
