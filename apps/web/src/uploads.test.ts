import { describe, expect, it } from "vitest";
import { selectStravaEntries } from "./uploads";

describe("Strava upload filtering", () => {
  it("retains activity inputs and excludes media", () => {
    expect(selectStravaEntries(["activities.csv", "activities/1.gpx", "media/photo.jpg"])).toEqual(["activities.csv", "activities/1.gpx"]);
  });

  it("requires the activity directory", () => {
    expect(() => selectStravaEntries(["activities.csv", "media/photo.jpg"])).toThrow("activities directory");
  });

  it("rejects traversal paths", () => expect(() => selectStravaEntries(["activities.csv", "activities/../private.txt", "activities/1.gpx"])).toThrow("unsafe path"));
});
