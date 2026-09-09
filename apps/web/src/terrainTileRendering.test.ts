import { describe, expect, it, vi } from "vitest";
import type { Map } from "maplibre-gl";
import { BinaryTerrainLayer, type SegmentBatch } from "./MapLibreTerrainRoutes";

function context() {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const gl = new Proxy({}, {
    get(_target, name: string) {
      if (/^[A-Z_0-9]+$/.test(name)) return 1;
      return calls[name] ??= vi.fn(() => name.startsWith("create") ? {} : true);
    },
  }) as WebGL2RenderingContext;
  return { gl, calls };
}
const data: SegmentBatch = {
  endpoints: new Float32Array([-0.1, 0.2, 0.6, 0.2, 0.8, 0.8, 0.9, 0.9]),
  colors: new Uint8Array(8), owners: new Uint32Array(2), activities: [], segmentCount: 2,
};
const tile = (x: number, y: number, wrap = 0) => ({ tileID: { canonical: { x, y, z: 1 }, wrap } }) as Parameters<BinaryTerrainLayer["renderToTile"]>[1];

describe("terrain GPU submissions", () => {
  it("submits only intersecting segments, including crossings and horizon tiles", () => {
    const { gl, calls } = context();
    const layer = new BinaryTerrainLayer();
    layer.setData(data, 2);
    layer.onAdd({ triggerRepaint: vi.fn() } as unknown as Map, gl);
    layer.renderToTile(gl, tile(0, 0));
    expect(calls.drawArraysInstanced).toHaveBeenLastCalledWith(gl.TRIANGLES, 0, 6, 1);
    layer.renderToTile(gl, tile(1, 1));
    expect(calls.drawArraysInstanced).toHaveBeenLastCalledWith(gl.TRIANGLES, 0, 6, 1);
  });
  it("reuses tile buffers and invalidates them when geometry changes", () => {
    const { gl, calls } = context();
    const layer = new BinaryTerrainLayer();
    layer.setData(data, 2);
    layer.onAdd({ triggerRepaint: vi.fn() } as unknown as Map, gl);
    layer.renderToTile(gl, tile(0, 0));
    const uploads = calls.bufferData.mock.calls.length;
    layer.renderToTile(gl, tile(0, 0, 1));
    expect(calls.bufferData).toHaveBeenCalledTimes(uploads);
    layer.setData(data, 4);
    expect(calls.deleteBuffer).toHaveBeenCalledTimes(2);
    layer.renderToTile(gl, tile(0, 0));
    expect(calls.bufferData).toHaveBeenCalledTimes(uploads + 2);
    layer.onRemove({} as Map, gl);
    expect(calls.deleteBuffer).toHaveBeenCalledTimes(4);
  });
});
