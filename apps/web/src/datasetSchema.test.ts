import { describe, expect, it } from "vitest";

import { assertSupportedDatasetSchema, SUPPORTED_DATASET_SCHEMA_VERSION } from "./datasetSchema";

describe("dataset schema compatibility", () => {
  it("accepts the current schema", () => {
    expect(SUPPORTED_DATASET_SCHEMA_VERSION).toBe("1.6.0");
    expect(() => assertSupportedDatasetSchema("1.6.0")).not.toThrow();
  });

  it("rejects stale schema 1.5 datasets", () => {
    expect(() => assertSupportedDatasetSchema("1.5.0")).toThrow(
      "Unsupported dataset schema 1.5.0",
    );
  });
});
