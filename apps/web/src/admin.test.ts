import { afterEach, describe, expect, it, vi } from "vitest";

import { recompileAdminUpload } from "./admin";

afterEach(() => vi.restoreAllMocks());

describe("admin upload recompiles", () => {
  it("requests a recompile for the selected user's upload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await recompileAdminUpload(
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

  it("surfaces a recompilable API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "upload_not_recompilable" }), { status: 409 }),
    );

    await expect(recompileAdminUpload(
      { apiUrl: "https://api.example", cognitoDomain: "https://login.example", cognitoClientId: "client" },
      { accessToken: "access", idToken: "identity" },
      "tester-subject",
      "upload-id",
    )).rejects.toThrow("Could not recompile upload (upload not recompilable).");
  });
});
