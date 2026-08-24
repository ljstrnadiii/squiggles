import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, identityFromSession, loadSession } from "./auth";

describe("browser authentication", () => {
  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

  it("returns no session when signed out", () => expect(loadSession()).toBeNull());
  it("clears stored sessions", () => { sessionStorage.setItem("squiggles-auth-session", "{}"); clearSession(); expect(loadSession()).toBeNull(); });
  it("reads display claims from the id token", () => {
    const payload = btoa(JSON.stringify({ email: "person@example.com", name: "Person" })).replaceAll("=", "");
    expect(identityFromSession({ accessToken: "access", idToken: `x.${payload}.x` })).toEqual({ email: "person@example.com", name: "Person" });
  });
});
