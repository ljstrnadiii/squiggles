export const SUPPORTED_DATASET_SCHEMA_VERSION = "1.6.0";

export function assertSupportedDatasetSchema(schemaVersion: string) {
  if (schemaVersion !== SUPPORTED_DATASET_SCHEMA_VERSION) {
    throw new Error(`Unsupported dataset schema ${schemaVersion}`);
  }
}
