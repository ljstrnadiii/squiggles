import { beforeEach, describe, expect, it } from "vitest";

import { highRunsTab, loadTabs } from "./storage";

const KEY = "activity-map.tabs.v1";

describe("stored query tabs", () => {
  beforeEach(() => localStorage.clear());

  it("migrates the built-in high-runs example away from legacy track_points SQL", () => {
    localStorage.setItem(KEY, JSON.stringify([
      {
        ...highRunsTab,
        sql: `SELECT activity_id
FROM activities
WHERE lower(sport_type) LIKE '%run%'
  AND EXISTS (
    SELECT 1
    FROM unnest(track_points) AS points(point)
    WHERE point.elevation_m >= 3657.6
  )`,
      },
    ]));

    const tab = loadTabs().find(item => item.id === highRunsTab.id);
    expect(tab?.sql).toBe(highRunsTab.sql);
    expect(tab?.sql).not.toContain("track_points");
  });
});
