import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, deleteAccount, identityFromSession, loadSession } from "./auth";

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
});
