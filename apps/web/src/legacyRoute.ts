const LEGACY_DATASET_PATH = /^\/m\/[0-9a-f-]{36}\/?$/i;

export function legacyDatasetRedirect(pathname: string, search: string) {
  return LEGACY_DATASET_PATH.test(pathname) ? `/${search}` : null;
}
