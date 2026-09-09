/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATASET_BASE_URL?: string;
  readonly VITE_CARTO_API_KEY?: string;
  readonly VITE_MAPBOX_ACCESS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
