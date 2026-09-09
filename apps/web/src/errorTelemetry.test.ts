import { describe, expect, it } from "vitest";

import { errorTelemetryTest } from "./errorTelemetry";

describe("error telemetry", () => {
  it("redacts secrets, urls, and local paths", () => {
    const value = errorTelemetryTest.sanitize(
      "Bearer abc123 https://example.com/a?token=secret /Users/len/code/file.ts password=hunter2",
      500,
    );
    expect(value).not.toContain("abc123");
    expect(value).not.toContain("example.com");
    expect(value).not.toContain("/Users/len");
    expect(value).not.toContain("hunter2");
    expect(value).toContain("[redacted]");
    expect(value).toContain("[url]");
    expect(value).toContain("[local-path]");
  });

  it("bounds error payload size", () => {
    const error = new Error("x".repeat(1000));
    error.stack = "s".repeat(4000);
    const normalized = errorTelemetryTest.normalizeError(error);
    expect(normalized.message.length).toBeLessThanOrEqual(500);
    expect(normalized.stack?.length).toBeLessThanOrEqual(1800);
  });

  it("marks ordinary SQL mistakes as query errors without downgrading runtime failures", () => {
    expect(errorTelemetryTest.duckdbErrorKind("execute", new Error("Binder Error: column nope not found"))).toBe("query");
    expect(errorTelemetryTest.duckdbErrorKind("execute", new Error("Out of Memory Error"))).toBe("unexpected");
    expect(errorTelemetryTest.duckdbErrorKind("renderViewport", new Error("Binder Error"))).toBe("unexpected");
  });

  it("strips the locally formatted SQL and file context from DuckDB telemetry", () => {
    const summary = errorTelemetryTest.duckdbErrorSummary(new Error([
      "Squiggles DuckDB failure",
      "Request: execute",
      "Files (1):",
      "- private/activity.parquet",
      "",
      "SQL:",
      "SELECT secret_column FROM activities",
      "",
      "DuckDB error:",
      "Binder Error: Referenced column not found",
      "LINE 1: SELECT secret_column FROM activities",
    ].join("\n")));
    expect(summary).toBe("Binder Error: Referenced column not found");
    expect(summary).not.toContain("SELECT");
    expect(summary).not.toContain("activity.parquet");
  });
});
