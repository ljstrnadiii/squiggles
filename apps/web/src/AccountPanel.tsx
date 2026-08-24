import { useEffect, useState } from "react";
import { beginGoogleLogin, clearSession, deleteAccount, finishLogin, getProfile, identityFromSession, loadRuntimeConfig, loadSession, type AuthSession, type RuntimeConfig, type UserProfile } from "./auth";
import { filterStravaArchive, listUploads, uploadArchive, type UploadRecord } from "./uploads";

export function AccountPanel({ onClose, onIdentityChange, view = "account" }: { onClose: () => void; onIdentityChange: () => void; view?: "account" | "upload" | "login" }) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pausedUpload, setPausedUpload] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const runtime = await loadRuntimeConfig();
        setConfig(runtime);
        if (!runtime) return;
        const authenticated = await finishLogin(runtime);
        setSession(authenticated);
        if (authenticated) { const next = { ...await getProfile(runtime, authenticated), ...identityFromSession(authenticated) }; setProfile(next); onIdentityChange(); if (next.status === "approved") setUploads(await listUploads(runtime, authenticated)); }
      } catch (reason) {
        if (!loadSession()) { setSession(null); setProfile(null); onIdentityChange(); }
        setError(reason instanceof Error ? reason.message : "Login failed.");
      }
      finally { setLoading(false); }
    })();
  }, [onIdentityChange]);
  useEffect(() => {
    if (!config || !session || profile?.status !== "approved") return;
    const timer = window.setInterval(() => { void listUploads(config, session).then(setUploads).catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, [config, session, profile?.status]);

  const signOut = () => { clearSession(); setSession(null); setProfile(null); setUploads([]); onIdentityChange(); };
  const removeAccount = async () => {
    if (!config || !session || !window.confirm("Delete your Squiggles account, uploads, compiled datasets, and saved metadata? This cannot be undone.")) return;
    setError("");
    try { await deleteAccount(config, session); setSession(null); setProfile(null); setUploads([]); onIdentityChange(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Account deletion failed."); }
  };
  const bytes = (value: number) => value < 1024 ** 2 ? `${Math.round(value / 1024)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(1)} GB`;
  const selectArchive = async (file?: File) => { if (!file || !config || !session) return; setUploading(true); setPausedUpload(null); setError(""); setProgress(0); try { const filtered = await filterStravaArchive(file); const resume = uploads.find(upload => upload.status === "uploading" && upload.filename === file.name && upload.byteSize === filtered.size); await uploadArchive(config, session, file.name, filtered, setProgress, resume?.id); setUploads(await listUploads(config, session)); } catch (reason) { setPausedUpload(file.name); setError(reason instanceof Error ? reason.message : "Upload paused. Select the archive again to resume."); } finally { setUploading(false); } };
  return <section className="system-settings utility-panel account-panel" aria-label="Account">
    <header><div>{view !== "upload" && <span className="eyebrow">{session ? "ACCOUNT" : "LOG IN"}</span>}<strong>{session ? view === "upload" ? "Upload Archive" : profile?.name || profile?.email : "Make Squiggles yours"}</strong></div><button aria-label="Close account" onClick={onClose}>×</button></header>
    {loading && <p>Checking your session…</p>}
    {error && <p className="account-error">{error}</p>}
    {!loading && !session && <><p>An account lets Squiggles compile your Strava archive, keep your maps available across devices, publish a stable link, and count its views.</p><button className="account-primary" disabled={!config} onClick={() => config && void beginGoogleLogin(config)}>Log in with Google</button></>}
    {profile && <>{view === "account" && <div className={`approval-status ${profile.status}`}><span aria-hidden="true" />Access {profile.status}</div>}{profile.status === "pending" && <p>Your first login worked. An administrator still needs to approve this account before private data or uploads are available.</p>}{profile.status === "approved" && view === "account" && <section className="account-stats"><div><strong>{profile.stats?.activityCount.toLocaleString() ?? "0"}</strong><span>processed activities</span></div><div><strong>{profile.stats?.datasetCount.toLocaleString() ?? "0"}</strong><span>processed datasets</span></div><div><strong>{bytes(profile.stats?.curatedBytes ?? 0)}</strong><span>curated data</span></div><div><strong>{bytes(profile.stats?.uploadedBytes ?? 0)}</strong><span>uploaded source</span></div><div><strong>{profile.stats?.publishedViews.toLocaleString() ?? "0"}</strong><span>published views</span></div><div><strong>{profile.stats?.publishedMaps.toLocaleString() ?? "0"}</strong><span>published maps</span></div></section>}{profile.status === "approved" && view === "upload" && <section className="account-upload"><p>Upload a Strava export. Squiggles sends only your activity files and skips media.</p><label className={`archive-dropzone ${uploading ? "uploading" : ""}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void selectArchive(event.dataTransfer.files[0]); }}><strong>{uploading ? `Uploading ${Math.round(progress * 100)}%` : "Drop a Strava ZIP here"}</strong><span>or choose a file</span><input type="file" accept=".zip,application/zip" disabled={uploading} onChange={event => void selectArchive(event.target.files?.[0])} /></label>{uploads.map(upload => { const paused = pausedUpload === upload.filename && upload.status === "uploading"; return <div className="upload-row" key={upload.id}><span>{upload.filename}{paused ? <small>Upload interrupted. Select this ZIP again to resume.</small> : upload.statusDetail && <small>{upload.statusDetail}</small>}</span><strong>{paused ? "paused" : upload.status}</strong></div>; })}</section>}{view === "account" && <div className="account-actions"><button onClick={signOut}>Sign out</button><button className="danger-button" onClick={() => void removeAccount()}>Delete account</button></div>}</>}
  </section>;
}
