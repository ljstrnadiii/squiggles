import { useEffect, useState } from "react";
import { beginGoogleLogin, clearSession, finishLogin, getProfile, identityFromSession, loadRuntimeConfig, type AuthSession, type RuntimeConfig, type UserProfile } from "./auth";

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const runtime = await loadRuntimeConfig();
        setConfig(runtime);
        if (!runtime) return;
        const authenticated = await finishLogin(runtime);
        setSession(authenticated);
        if (authenticated) setProfile({ ...await getProfile(runtime, authenticated), ...identityFromSession(authenticated) });
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Login failed."); }
      finally { setLoading(false); }
    })();
  }, []);

  const signOut = () => { clearSession(); setSession(null); setProfile(null); };
  return <section className="system-settings utility-panel account-panel" aria-label="Account">
    <header><div><span className="eyebrow">ACCOUNT</span><strong>{profile?.name || profile?.email || "Google sign in"}</strong></div><button aria-label="Close account" onClick={onClose}>×</button></header>
    {loading && <p>Checking your session…</p>}
    {error && <p className="account-error">{error}</p>}
    {!loading && !session && <><p>Sign in to request access and, once approved, keep your Squiggles datasets and queries across devices.</p><button className="account-primary" disabled={!config} onClick={() => config && void beginGoogleLogin(config)}>Continue with Google</button></>}
    {profile && <><div className={`approval-status ${profile.status}`}><span aria-hidden="true" />Access {profile.status}</div>{profile.status === "pending" && <p>Your first login worked. An administrator still needs to approve this account before private data or uploads are available.</p>}<button onClick={signOut}>Sign out</button></>}
  </section>;
}
