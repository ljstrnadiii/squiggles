export type RuntimeConfig = { apiUrl: string; cognitoDomain: string; cognitoClientId: string; defaultDatasetId?: string };
export type AuthSession = { accessToken: string; idToken: string; refreshToken?: string };
export type Identity = { email?: string; name?: string; picture?: string };
export type CompileProgress = { filename: string; status: string; statusDetail: string; progressCompleted: number; progressTotal: number };
export type UserProfile = Identity & { subject: string; status: "pending" | "approved" | "rejected"; role: "user" | "admin"; compile?: CompileProgress | null; stats?: { uploadedBytes: number; curatedBytes: number; datasetCount: number; activityCount: number; publishedViews: number; publishedMaps: number } };

const sessionKey = "squiggles-auth-session";
const verifierKey = "squiggles-auth-verifier";
const stateKey = "squiggles-auth-state";

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const randomValue = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

export async function loadRuntimeConfig(): Promise<RuntimeConfig | null> {
  const response = await fetch("/runtime-config.json", { cache: "no-store" });
  if (!response.ok) return null;
  return response.json() as Promise<RuntimeConfig>;
}

export function loadSession(): AuthSession | null {
  try {
    const stored = localStorage.getItem(sessionKey) ?? sessionStorage.getItem(sessionKey);
    const session = JSON.parse(stored ?? "null") as AuthSession | null;
    if (session && !localStorage.getItem(sessionKey)) localStorage.setItem(sessionKey, JSON.stringify(session));
    return session;
  } catch { return null; }
}

export function clearSession() { localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey); }

async function refreshSession(config: RuntimeConfig, session: AuthSession): Promise<boolean> {
  if (!session.refreshToken) return false;
  const response = await fetch(new URL("/oauth2/token", config.cognitoDomain), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: config.cognitoClientId, refresh_token: session.refreshToken }),
  });
  if (!response.ok) return false;
  const tokens = await response.json() as { access_token: string; id_token?: string };
  session.accessToken = tokens.access_token;
  if (tokens.id_token) session.idToken = tokens.id_token;
  localStorage.setItem(sessionKey, JSON.stringify(session));
  return true;
}

export async function authFetch(config: RuntimeConfig, session: AuthSession, input: string, init: RequestInit = {}): Promise<Response> {
  const send = () => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${session.accessToken}` } });
  let response = await send();
  if (response.status !== 401) return response;
  if (!await refreshSession(config, session)) { clearSession(); return response; }
  response = await send();
  if (response.status === 401) clearSession();
  return response;
}

export function identityFromSession(session: AuthSession | null): Identity {
  if (!session?.idToken) return {};
  try {
    const payload = session.idToken.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(atob(payload)) as Identity;
  } catch { return {}; }
}

export async function beginGoogleLogin(config: RuntimeConfig) {
  const verifier = randomValue();
  const state = randomValue();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  sessionStorage.setItem(verifierKey, verifier);
  sessionStorage.setItem(stateKey, state);
  const redirectUri = `${window.location.origin}/auth/callback`;
  const url = new URL("/oauth2/authorize", config.cognitoDomain);
  url.search = new URLSearchParams({ response_type: "code", client_id: config.cognitoClientId, redirect_uri: redirectUri, scope: "openid email profile", identity_provider: "Google", code_challenge_method: "S256", code_challenge: base64Url(new Uint8Array(digest)), state }).toString();
  window.location.assign(url);
}

export async function finishLogin(config: RuntimeConfig): Promise<AuthSession | null> {
  if (window.location.pathname !== "/auth/callback") return loadSession();
  const parameters = new URLSearchParams(window.location.search);
  const verifier = sessionStorage.getItem(verifierKey);
  const expectedState = sessionStorage.getItem(stateKey);
  if (!verifier || !expectedState || parameters.get("state") !== expectedState || !parameters.get("code")) throw new Error("The login response could not be verified. Please try again.");
  const response = await fetch(new URL("/oauth2/token", config.cognitoDomain), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.cognitoClientId, code: parameters.get("code")!, redirect_uri: `${window.location.origin}/auth/callback`, code_verifier: verifier }),
  });
  if (!response.ok) throw new Error("Cognito could not complete the login.");
  const tokens = await response.json() as { access_token: string; id_token: string; refresh_token?: string };
  const session = { accessToken: tokens.access_token, idToken: tokens.id_token, refreshToken: tokens.refresh_token };
  localStorage.setItem(sessionKey, JSON.stringify(session));
  sessionStorage.removeItem(verifierKey);
  sessionStorage.removeItem(stateKey);
  window.history.replaceState({}, "", "/");
  return session;
}

export async function getProfile(config: RuntimeConfig, session: AuthSession): Promise<UserProfile> {
  const response = await authFetch(config, session, `${config.apiUrl}/api/me`, { cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "Your session expired. Please sign in again." : "Could not load your account.");
  return response.json() as Promise<UserProfile>;
}

export async function deleteAccount(config: RuntimeConfig, session: AuthSession): Promise<void> {
  const response = await authFetch(config, session, `${config.apiUrl}/api/me`, { method: "DELETE" });
  if (!response.ok) throw new Error("Could not delete your account and data.");
  clearSession();
}
