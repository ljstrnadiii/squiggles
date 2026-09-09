import { describe, expect, it } from "vitest";
import { planRenderLod } from "./renderLodPlan";
const levels = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const counts = [1000, 20_000, 95_000, 200_000, 700_000, 1_200_000, 2_000_000, 3_000_000];
const estimate = async (lod: number) => counts[lod];
describe("render LOD allocation", () => {
  it("spends spare budget above a coarse requested LOD", async () => {
    expect(await planRenderLod(levels, 2, 1_250_000, true, estimate)).toEqual({ lod: 5, vertexEstimate: 1_200_000 });
  });
  it("stops before the first finer level that crosses the budget", async () => {
    expect((await planRenderLod(levels, 2, 1_250_000, true, estimate)).lod).toBe(5);
  });
  it("can honor the screen-space target and preserve every route", async () => {
    expect((await planRenderLod(levels, 2, 1_250_000, false, estimate)).lod).toBe(2);
    expect((await planRenderLod(levels, 7, 1_250_000, false, estimate)).lod).toBe(5);
  });
  it("stops at full geometry when the dataset is smaller than the budget", async () => {
    expect((await planRenderLod(levels, 2, 4_000_000, true, estimate)).lod).toBe(7);
  });
});
