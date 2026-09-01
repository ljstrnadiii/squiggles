import { BlobReader, BlobWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { authFetch, type AuthSession, type RuntimeConfig } from "./auth";

export type UploadRecord = { id: string; filename: string; byteSize: number; status: string; statusDetail: string; progressCompleted: number; progressTotal: number; createdAt: string };

const terminalUploadStatuses = new Set(["ready", "failed"]);

export function reconcileUploadStatuses(uploads: UploadRecord[], datasetCount: number): UploadRecord[] {
  let remaining = Math.max(0, datasetCount - uploads.filter(upload => upload.status === "ready").length);
  const promote = new Set(
    uploads
      .filter(upload => !terminalUploadStatuses.has(upload.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, remaining)
      .map(upload => upload.id),
  );
  return uploads.map(upload => promote.has(upload.id) ? { ...upload, status: "ready", statusDetail: "Compiled dataset ready." } : upload);
}

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
    const created = await authFetch(config, session, `${config.apiUrl}/api/uploads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename, size: archive.size }) });
    if (!created.ok) throw new Error(`Could not authorize upload (${created.status}).`);
    id = (await created.json() as { id: string }).id;
  }
  const existingResponse = await authFetch(config, session, `${config.apiUrl}/api/uploads/${id}/parts`, { cache: "no-store" });
  const existing = new Map((existingResponse.ok ? (await existingResponse.json() as { parts: Array<{ partNumber: number; checksumSha256: string }> }).parts : []).map(part => [part.partNumber, part.checksumSha256]));
  const partSize = 8 * 1024 * 1024;
  let uploaded = 0;
  for (let offset = 0, partNumber = 1; offset < archive.size; offset += partSize, partNumber++) {
    const part = archive.slice(offset, Math.min(offset + partSize, archive.size));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await part.arrayBuffer()));
    const checksumSha256 = btoa(String.fromCharCode(...digest));
    if (existing.get(partNumber) !== checksumSha256) {
      const signed = await authFetch(config, session, `${config.apiUrl}/api/uploads/${id}/parts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ partNumber, checksumSha256 }) });
      if (!signed.ok) throw new Error(`Could not authorize upload part ${partNumber}.`);
      const uploadUrl = (await signed.json() as { uploadUrl: string }).uploadUrl;
      let succeeded = false;
      let failure = "network error";
      for (let attempt = 0; attempt < 3 && !succeeded; attempt++) {
        if (attempt) await new Promise(resolve => window.setTimeout(resolve, attempt * 1000));
        try {
          const result = await fetch(uploadUrl, { method: "PUT", headers: { "x-amz-checksum-sha256": checksumSha256 }, body: part });
          succeeded = result.ok;
          if (!result.ok) {
            const detail = (await result.text()).match(/<Code>([^<]+)<\/Code>/)?.[1];
            failure = `${result.status}${detail ? ` ${detail}` : ""}`;
          }
        } catch (reason) {
          failure = reason instanceof Error ? reason.message : "network error";
        }
      }
      if (!succeeded) throw new Error(`Part ${partNumber} could not upload (${failure}). Check your connection, then select this ZIP again to resume.`);
    }
    uploaded += part.size; progress(uploaded / archive.size);
  }
  const completed = await authFetch(config, session, `${config.apiUrl}/api/uploads/${id}/complete`, { method: "POST" });
  if (!completed.ok) throw new Error(`Upload verification failed (${completed.status}).`);
  return completed.json() as Promise<{ id: string; status: string }>;
}

export async function listUploads(config: RuntimeConfig, session: AuthSession): Promise<UploadRecord[]> {
  const response = await authFetch(config, session, `${config.apiUrl}/api/uploads`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load uploads.");
  return (await response.json() as { uploads: UploadRecord[] }).uploads;
}
