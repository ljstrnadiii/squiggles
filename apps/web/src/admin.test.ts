import { afterEach, describe, expect, it, vi } from "vitest";

import { retryAdminUpload } from "./admin";

afterEach(() => vi.restoreAllMocks());

describe("admin upload retries", () => {
  it("requests a retry for the selected user's failed upload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await retryAdminUpload(
      { apiUrl: "https://api.example", cognitoDomain: "https://login.example", cognitoClientId: "client" },
      { accessToken: "access", idToken: "identity" },
      "tester-subject",
      "upload-id",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/admin/uploads/upload-id/retry",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ subject: "tester-subject" }),
      }),
    );
  });

  it("surfaces a retryable API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "upload_not_retryable" }), { status: 409 }),
    );

    await expect(retryAdminUpload(
      { apiUrl: "https://api.example", cognitoDomain: "https://login.example", cognitoClientId: "client" },
      { accessToken: "access", idToken: "identity" },
      "tester-subject",
      "upload-id",
    )).rejects.toThrow("Could not retry upload (upload not retryable).");
  });
});
