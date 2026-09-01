import { describe, expect, it } from "vitest";
import { reconcileUploadStatuses, selectStravaEntries, type UploadRecord } from "./uploads";

const upload = (id: string, status: string, createdAt: string): UploadRecord => ({ id, filename: `${id}.zip`, byteSize: 1, status, statusDetail: "", progressCompleted: 0, progressTotal: 0, createdAt });

describe("activity archive uploads", () => {
  it("retains activity inputs and excludes media", () => {
    expect(selectStravaEntries(["activities.csv", "activities/1.gpx", "media/photo.jpg"])).toEqual(["activities.csv", "activities/1.gpx"]);
  });

  it("requires the activity directory", () => {
    expect(() => selectStravaEntries(["activities.csv", "media/photo.jpg"])).toThrow("activities directory");
  });

  it("rejects traversal paths", () => expect(() => selectStravaEntries(["activities.csv", "activities/../private.txt", "activities/1.gpx"])).toThrow("unsafe path"));

  it("treats a compiled dataset as authoritative over stale processing status", () => {
    expect(reconcileUploadStatuses([upload("a", "compiling", "2026-01-01")], 1)[0]).toMatchObject({ status: "ready", statusDetail: "Compiled dataset ready." });
  });

  it("preserves failures and reconciles the oldest successful pipelines first", () => {
    const result = reconcileUploadStatuses([
      upload("new", "compiling", "2026-01-03"),
      upload("failed", "failed", "2026-01-01"),
      upload("old", "compiling", "2026-01-02"),
    ], 1);
    expect(result.find(item => item.id === "old")?.status).toBe("ready");
    expect(result.find(item => item.id === "new")?.status).toBe("compiling");
    expect(result.find(item => item.id === "failed")?.status).toBe("failed");
  });
});
