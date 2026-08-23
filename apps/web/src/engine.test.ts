import { describe, expect, it } from "vitest";

import type { QueryTab, ViewportResult } from "./contracts";
import { BrowserDuckDBEngine } from "./engine";
import { defaultTab } from "./storage";

const viewport = (): Omit<ViewportResult, "cache"> => ({
  batches: [{
    activities: [{ activityId: "a", name: "A", sportType: "Run", startTime: null, distanceM: null, elevationGainM: null, maxElevationM: null, sourceUrl: null }],
    positions: new Float64Array([-105, 40, -104, 41]),
    startIndices: new Uint32Array([0, 2]),
    segmentActivityIndices: new Uint32Array([0]),
  }],
  activityCount: 1,
  geometryBufferBytes: 32,
  lod: 2,
  vertexCount: 2,
  plannedVertexEstimate: 2,
  rawVertexEstimate: 2,
  vertexBudget: 100,
  scan: { candidateFragmentCount: 1, totalFragmentCount: 1, candidateBytes: 32, totalBytes: 32, expectedRowGroupCount: 1, candidateRowGroupCount: 1, totalRowGroupCount: 1, expectedRowCount: 1, keptRowCount: 1 },
});

describe("BrowserDuckDBEngine viewport cache", () => {
  it("reuses the same transferred GeoArrow buffers for an identical viewport", async () => {
    const posted: unknown[] = [];
    class WorkerMock {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage(message: { id: number }) {
        posted.push(message);
        const value = { queryId: "1", summary: {}, renderPlan: { type: "arrow", activityIds: ["a"] }, ...viewport() };
        queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ok: true, value } } as MessageEvent));
      }
    }
    const originalWorker = globalThis.Worker;
    globalThis.Worker = WorkerMock as unknown as typeof Worker;
    const engine = new BrowserDuckDBEngine();
    const tab: QueryTab = { ...defaultTab, style: { ...defaultTab.style }, sql: "SELECT activity_id FROM activities" };
    const bounds: [number, number, number, number] = [-105.3, 39.9, -105.1, 40.1];
    const first = await engine.execute(tab, 12, bounds);
    const second = await engine.renderViewport(12, bounds);
    expect(posted).toHaveLength(1);
    expect(second.cache.hit).toBe(true);
    expect(second.batches[0].positions).toBe(first.batches[0].positions);
    expect(second.batches[0].positions.buffer).toBe(first.batches[0].positions.buffer);
    globalThis.Worker = originalWorker;
  });
});
