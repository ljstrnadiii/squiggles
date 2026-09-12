import { authFetch, type AuthSession, type RuntimeConfig } from "./auth";
import type { DatasetManifest, DatasetSource } from "./contracts";

type DatasetAccess = { datasetId: string; manifest: DatasetManifest };

function source(access: DatasetAccess): DatasetSource {
  return { kind: "url", baseUrl: "", name: access.datasetId, manifest: access.manifest };
}

export async function loadPrivateDataset(
  config: RuntimeConfig,
  session: AuthSession,
  datasetId: string,
): Promise<DatasetSource> {
  const response = await authFetch(config, session, `${config.apiUrl}/api/datasets/${datasetId}/access`, { cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 403 ? "You do not have access to this map." : "Could not open this map.");
  return source(await response.json() as DatasetAccess);
}

export async function loadPublishedDataset(
  config: RuntimeConfig,
  slug: string,
): Promise<DatasetSource> {
  const response = await fetch(`${config.apiUrl}/api/published/${slug}/dataset-access`, { cache: "no-store" });
  if (!response.ok) throw new Error("This published map's dataset could not be opened.");
  return source(await response.json() as DatasetAccess);
}
