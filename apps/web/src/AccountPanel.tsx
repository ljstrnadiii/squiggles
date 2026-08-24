import { useEffect, useState } from "react";
import { beginGoogleLogin, clearSession, finishLogin, getProfile, identityFromSession, loadRuntimeConfig, type AuthSession, type RuntimeConfig, type UserProfile } from "./auth";
import { filterStravaArchive, listUploads, uploadArchive, type UploadRecord } from "./uploads";

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const runtime = await loadRuntimeConfig();
        setConfig(runtime);
        if (!runtime) return;
        const authenticated = await finishLogin(runtime);
        setSession(authenticated);
        if (authenticated) { const next = { ...await getProfile(runtime, authenticated), ...identityFromSession(authenticated) }; setProfile(next); if (next.status === "approved") setUploads(await listUploads(runtime, authenticated)); }
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Login failed."); }
      finally { setLoading(false); }
    })();
  }, []);
  useEffect(() => {
    if (!config || !session || profile?.status !== "approved") return;
    const timer = window.setInterval(() => { void listUploads(config, session).then(setUploads).catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, [config, session, profile?.status]);

  const signOut = () => { clearSession(); setSession(null); setProfile(null); };
  const selectArchive = async (file?: File) => { if (!file || !config || !session) return; setUploading(true); setError(""); setProgress(0); try { const filtered = await filterStravaArchive(file); const resume = uploads.find(upload => upload.status === "uploading" && upload.filename === file.name && upload.byteSize === filtered.size); await uploadArchive(config, session, file.name, filtered, setProgress, resume?.id); setUploads(await listUploads(config, session)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed."); } finally { setUploading(false); } };
  return <section className="system-settings utility-panel account-panel" aria-label="Account">
    <header><div><span className="eyebrow">ACCOUNT</span><strong>{profile?.name || profile?.email || "Google sign in"}</strong></div><button aria-label="Close account" onClick={onClose}>×</button></header>
    {loading && <p>Checking your session…</p>}
    {error && <p className="account-error">{error}</p>}
    {!loading && !session && <><p>Sign in to request access and, once approved, keep your Squiggles datasets and queries across devices.</p><button className="account-primary" disabled={!config} onClick={() => config && void beginGoogleLogin(config)}>Continue with Google</button></>}
    {profile && <><div className={`approval-status ${profile.status}`}><span aria-hidden="true" />Access {profile.status}</div>{profile.status === "pending" && <p>Your first login worked. An administrator still needs to approve this account before private data or uploads are available.</p>}{profile.status === "approved" && <section className="account-upload"><h3>Strava archive</h3><p>Select the ZIP from Strava. Squiggles sends only <code>activities.csv</code> and <code>activities/</code>; media stays on this device. Uploads use retryable 8 MB parts for mobile connections. If interrupted, reselect the same ZIP to resume. If filtering fails, extract the archive and retain only those two items.</p><label className="account-primary">{uploading ? `Uploading ${Math.round(progress * 100)}%` : "Choose Strava ZIP"}<input type="file" accept=".zip,application/zip" disabled={uploading} onChange={event => void selectArchive(event.target.files?.[0])} /></label>{uploads.map(upload => <div className="upload-row" key={upload.id}><span>{upload.filename}{upload.statusDetail && <small>{upload.statusDetail}</small>}</span><strong>{upload.status}</strong></div>)}</section>}<button onClick={signOut}>Sign out</button></>}
  </section>;
}
