import { BlobReader, BlobWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import type { AuthSession, RuntimeConfig } from "./auth";

export type UploadRecord = { id: string; filename: string; byteSize: number; status: string; statusDetail: string; createdAt: string };
const auth = (session: AuthSession) => ({ authorization: `Bearer ${session.accessToken}` });

export function selectStravaEntries(names: string[]) {
  const selected = names.filter(name => name === "activities.csv" || name.startsWith("activities/"));
  if (!selected.includes("activities.csv") || !selected.some(name => name.startsWith("activities/") && !name.endsWith("/"))) throw new Error("This archive must contain activities.csv and the activities directory.");
  if (selected.length > 100_000) throw new Error("This archive contains too many activity files.");
  for (const name of selected) if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("The archive contains an unsafe path.");
  return selected;
}

export async function filterStravaArchive(file: Blob): Promise<Blob> {
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const names = new Set(selectStravaEntries(entries.map(entry => entry.filename)));
  const selected = entries.filter(entry => names.has(entry.filename));
  const output = new BlobWriter("application/zip");
  const writer = new ZipWriter(output);
  for (const entry of selected) {
    if (entry.directory) continue;
    const data = await entry.getData?.(new BlobWriter());
    if (!data) throw new Error(`Could not read ${entry.filename}.`);
    await writer.add(entry.filename, new BlobReader(data));
  }
  const filtered = await writer.close();
  await reader.close();
  if (filtered.size > 1_500_000_000) throw new Error("The filtered activity archive exceeds 1.5 GB. Extract it and select activities.csv plus the activities directory instead.");
  return filtered;
}

export async function uploadArchive(config: RuntimeConfig, session: AuthSession, filename: string, archive: Blob, progress: (value: number) => void, resumeId?: string) {
  let id = resumeId;
  if (!id) {
    const created = await fetch(`${config.apiUrl}/api/uploads`, { method: "POST", headers: { ...auth(session), "content-type": "application/json" }, body: JSON.stringify({ filename, size: archive.size }) });
    if (!created.ok) throw new Error(`Could not authorize upload (${created.status}).`);
    id = (await created.json() as { id: string }).id;
  }
  const existingResponse = await fetch(`${config.apiUrl}/api/uploads/${id}/parts`, { headers: auth(session), cache: "no-store" });
  const existing = new Map((existingResponse.ok ? (await existingResponse.json() as { parts: Array<{ partNumber: number; checksumSha256: string }> }).parts : []).map(part => [part.partNumber, part.checksumSha256]));
  const partSize = 8 * 1024 * 1024;
  let uploaded = 0;
  for (let offset = 0, partNumber = 1; offset < archive.size; offset += partSize, partNumber++) {
    const part = archive.slice(offset, Math.min(offset + partSize, archive.size));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await part.arrayBuffer()));
    const checksumSha256 = btoa(String.fromCharCode(...digest));
    if (existing.get(partNumber) !== checksumSha256) {
      const signed = await fetch(`${config.apiUrl}/api/uploads/${id}/parts`, { method: "POST", headers: { ...auth(session), "content-type": "application/json" }, body: JSON.stringify({ partNumber, checksumSha256 }) });
      if (!signed.ok) throw new Error(`Could not authorize upload part ${partNumber}.`);
      const uploadUrl = (await signed.json() as { uploadUrl: string }).uploadUrl;
      let succeeded = false;
      for (let attempt = 0; attempt < 3 && !succeeded; attempt++) {
        const result = await fetch(uploadUrl, { method: "PUT", headers: { "x-amz-checksum-sha256": checksumSha256 }, body: part });
        succeeded = result.ok;
      }
      if (!succeeded) throw new Error(`Part ${partNumber} failed after three attempts. Reselect this ZIP to resume.`);
    }
    uploaded += part.size; progress(uploaded / archive.size);
  }
  const completed = await fetch(`${config.apiUrl}/api/uploads/${id}/complete`, { method: "POST", headers: auth(session) });
  if (!completed.ok) throw new Error(`Upload verification failed (${completed.status}).`);
  return completed.json() as Promise<{ id: string; status: string }>;
}

export async function listUploads(config: RuntimeConfig, session: AuthSession): Promise<UploadRecord[]> {
  const response = await fetch(`${config.apiUrl}/api/uploads`, { headers: auth(session), cache: "no-store" });
  if (!response.ok) throw new Error("Could not load uploads.");
  return (await response.json() as { uploads: UploadRecord[] }).uploads;
}
