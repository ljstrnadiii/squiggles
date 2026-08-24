import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { beforeAll, describe, expect, it } from "vitest";
import { filterStravaArchive } from "./uploads";

beforeAll(() => {
  Blob.prototype.arrayBuffer ??= function () { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this); }); };
  Blob.prototype.stream ??= function () { const content = this.arrayBuffer(); return new ReadableStream({ async start(controller) { controller.enqueue(new Uint8Array(await content)); controller.close(); } }); };
});

async function archive(entries: Record<string, string>) {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [name, contents] of Object.entries(entries)) await writer.add(name, new TextReader(contents));
  return new File([await writer.close()], "export.zip", { type: "application/zip" });
}

describe("Strava upload filtering", () => {
  it("retains activity inputs and excludes media", async () => {
    const filtered = await filterStravaArchive(await archive({ "activities.csv": "id", "activities/1.gpx": "track", "media/photo.jpg": "private" }));
    const names = (await new ZipReader(new BlobReader(filtered)).getEntries()).map(entry => entry.filename);
    expect(names).toEqual(["activities.csv", "activities/1.gpx"]);
  });

  it("requires the activity directory", async () => {
    await expect(filterStravaArchive(await archive({ "activities.csv": "id", "media/photo.jpg": "private" }))).rejects.toThrow("activities directory");
  });
});
