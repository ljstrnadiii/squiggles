import { beforeEach, describe, expect, it } from "vitest";

import { defaultTab, highRunsTab, loadTabs, mapStorageScope, saveTabs } from "./storage";

describe("map-scoped query tabs", () => {
  beforeEach(() => localStorage.clear());

  it("starts a new map with one all-activity 2D view", () => {
    localStorage.setItem("activity-map.tabs.v1", JSON.stringify([highRunsTab]));
    const tabs = loadTabs("map:31ea1577-b6f1-423a-8bda-ea7712345678");
    expect(tabs).toEqual([defaultTab]);
    expect(tabs[0].style.viewMode).toBe("2d");
  });

  it("keeps tabs isolated by map", () => {
    saveTabs([highRunsTab], "map:first");
    expect(loadTabs("map:first")[0].id).toBe(highRunsTab.id);
    expect(loadTabs("map:second")).toEqual([defaultTab]);
  });

  it("derives stable scopes from canonical and legacy map routes", () => {
    expect(mapStorageScope("/m/31ea1577-b6f1-423a-8bda-ea7712345678", "")).toBe("map:31ea1577-b6f1-423a-8bda-ea7712345678");
    expect(mapStorageScope("/p/abcd1234", "")).toBe("published:abcd1234");
  });
});