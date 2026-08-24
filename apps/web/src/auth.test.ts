import { beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch, clearSession, deleteAccount, identityFromSession, loadSession } from "./auth";

describe("browser authentication", () => {
  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

  it("returns no session when signed out", () => expect(loadSession()).toBeNull());
  it("clears stored sessions", () => { sessionStorage.setItem("squiggles-auth-session", "{}"); clearSession(); expect(loadSession()).toBeNull(); });
  it("reads display claims from the id token", () => {
    const payload = btoa(JSON.stringify({ email: "person@example.com", name: "Person" })).replaceAll("=", "");
    expect(identityFromSession({ accessToken: "access", idToken: `x.${payload}.x` })).toEqual({ email: "person@example.com", name: "Person" });
  });
  it("deletes the authenticated account and clears its browser session", async () => {
    sessionStorage.setItem("squiggles-auth-session", "{}");
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await deleteAccount({ apiUrl: "https://api.example.com", cognitoDomain: "", cognitoClientId: "" }, { accessToken: "access", idToken: "id" });
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/api/me", expect.objectContaining({ method: "DELETE" }));
    expect(loadSession()).toBeNull();
  });
  it("refreshes an expired access token and retries the request", async () => {
    const session = { accessToken: "expired", idToken: "id", refreshToken: "refresh" };
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "renewed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const response = await authFetch({ apiUrl: "https://api.example.com", cognitoDomain: "https://login.example.com", cognitoClientId: "client" }, session, "https://api.example.com/api/me");
    expect(response.status).toBe(200);
    expect(session.accessToken).toBe("renewed");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
