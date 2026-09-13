import { authFetch, loadSession, type AuthSession, type RuntimeConfig } from "./auth";
import type { DatasetManifest, DatasetSource } from "./contracts";
import type { MapIdentity } from "./mapIdentity";

type DatasetAccess = { datasetId: string; manifest: DatasetManifest; identity?: MapIdentity };
export type OpenedDataset = { source: DatasetSource; identity?: MapIdentity };

function source(access: DatasetAccess): DatasetSource {
  return { kind: "url", baseUrl: "", name: access.datasetId, manifest: access.manifest };
}

export async function loadPrivateDataset(
  config: RuntimeConfig,
  session: AuthSession,
  datasetId: string,
): Promise<OpenedDataset> {
  const response = await authFetch(config, session, `${config.apiUrl}/api/datasets/${datasetId}/access`, { cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 403 ? "You do not have access to this map." : "Could not open this map.");
  const access = await response.json() as DatasetAccess;
  return { source: source(access), identity: access.identity };
}

export async function loadPublishedDataset(
  config: RuntimeConfig,
  mapRef: string,
): Promise<DatasetSource> {
  if (/^[0-9a-f-]{36}$/i.test(mapRef)) {
    const session = loadSession();
    if (session) {
      const privateResponse = await authFetch(config, session, `${config.apiUrl}/api/datasets/${mapRef}/access`, { cache: "no-store" });
      if (privateResponse.ok) return source(await privateResponse.json() as DatasetAccess);
      if (![403, 404].includes(privateResponse.status)) throw new Error("This map's dataset could not be opened.");
    }
  }
  const response = await fetch(`${config.apiUrl}/api/published/${mapRef}/dataset-access`, { cache: "no-store" });
  if (!response.ok) throw new Error("This map's dataset could not be opened.");
  return source(await response.json() as DatasetAccess);
}
