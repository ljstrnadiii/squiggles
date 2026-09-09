import { describe, expect, it } from "vitest";
import { heatBudgetActivityIds } from "./heatSampling";

describe("heatBudgetActivityIds", () => {
  it("keeps every activity when the viewport is within budget", () => {
    const kept = heatBudgetActivityIds([
      { activityId: "cold", vertexCount: 30, heatScore: 0 },
      { activityId: "hot", vertexCount: 40, heatScore: 100 },
    ], 100);
    expect([...kept].sort()).toEqual(["cold", "hot"]);
  });

  it("drops hotter redundant activities before cold unique ones", () => {
    const kept = heatBudgetActivityIds([
      { activityId: "unique", vertexCount: 40, heatScore: 0 },
      { activityId: "warm", vertexCount: 40, heatScore: 10 },
      { activityId: "hot", vertexCount: 40, heatScore: 100 },
    ], 80);
    expect([...kept].sort()).toEqual(["unique", "warm"]);
  });

  it("uses activity id as a stable tie breaker", () => {
    const kept = heatBudgetActivityIds([
      { activityId: "b", vertexCount: 60, heatScore: 10 },
      { activityId: "a", vertexCount: 60, heatScore: 10 },
    ], 60);
    expect([...kept]).toEqual(["a"]);
  });
});
