import { useEffect, useState } from "react";
import { listAdminUsers, setAdminUserAccess, type AdminUser } from "./admin";
import "./admin.css";
import { beginGoogleLogin, clearSession, deleteAccount, finishLogin, getProfile, identityFromSession, loadRuntimeConfig, loadSession, type AuthSession, type RuntimeConfig, type UserProfile } from "./auth";
import { filterStravaArchive, listUploads, reconcileUploadStatuses, uploadArchive, type UploadRecord } from "./uploads";

export function AccountPanel({ onClose, onIdentityChange, view = "account" }: { onClose: () => void; onIdentityChange: () => void; view?: "account" | "upload" | "login" }) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
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
        if (authenticated) {
          const next = { ...await getProfile(runtime, authenticated), ...identityFromSession(authenticated) };
          setProfile(next);
          onIdentityChange();
          if (next.status === "approved") setUploads(reconcileUploadStatuses(await listUploads(runtime, authenticated), next.stats?.datasetCount ?? 0));
          if (next.role === "admin") setAdminUsers(await listAdminUsers(runtime, authenticated));
        }
      } catch (reason) {
        if (!loadSession()) { setSession(null); setProfile(null); onIdentityChange(); }
        setError(reason instanceof Error ? reason.message : "Login failed.");
      } finally { setLoading(false); }
    })();
  }, [onIdentityChange]);

  useEffect(() => {
    if (!config || !session || profile?.status !== "approved") return;
    const timer = window.setInterval(() => {
      void Promise.all([getProfile(config, session), listUploads(config, session)]).then(([nextProfile, nextUploads]) => {
        const next = { ...nextProfile, ...identityFromSession(session) };
        setProfile(next);
        setUploads(reconcileUploadStatuses(nextUploads, next.stats?.datasetCount ?? 0));
      }).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [config, session, profile?.status]);

  useEffect(() => {
    if (!config || !session || profile?.role !== "admin" || view !== "account") return;
    const timer = window.setInterval(() => { void listAdminUsers(config, session).then(setAdminUsers).catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, [config, session, profile?.role, view]);

  const signOut = () => { clearSession(); setSession(null); setProfile(null); setUploads([]); setAdminUsers([]); onIdentityChange(); };
  const removeAccount = async () => {
    if (!config || !session || !window.confirm("Delete your Squiggles account, uploads, compiled datasets, and saved metadata? This cannot be undone.")) return;
    setError("");
    try { await deleteAccount(config, session); setSession(null); setProfile(null); setUploads([]); setAdminUsers([]); onIdentityChange(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Account deletion failed."); }
  };
  const bytes = (value: number) => value < 1024 ** 2 ? `${Math.round(value / 1024)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(1)} GB`;
  const selectArchive = async (file?: File) => { if (!file || !config || !session) return; setUploading(true); setPausedUpload(null); setError(""); setProgress(0); try { const filtered = await filterStravaArchive(file); const resume = uploads.find(upload => upload.status === "uploading" && upload.filename === file.name && upload.byteSize === filtered.size); await uploadArchive(config, session, file.name, filtered, setProgress, resume?.id); const next = await getProfile(config, session); setProfile({ ...next, ...identityFromSession(session) }); setUploads(reconcileUploadStatuses(await listUploads(config, session), next.stats?.datasetCount ?? 0)); } catch (reason) { setPausedUpload(file.name); setError(reason instanceof Error ? reason.message : "Upload paused. Select the archive again to resume."); } finally { setUploading(false); } };
  const changeAccess = async (user: AdminUser, status: AdminUser["status"]) => {
    if (!config || !session || user.status === status) return;
    setAdminLoading(true); setError("");
    try { await setAdminUserAccess(config, session, user.subject, status); setAdminUsers(await listAdminUsers(config, session)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update user access."); }
    finally { setAdminLoading(false); }
  };

  return <section className="system-settings utility-panel account-panel" aria-label="Account">
    <header><div>{view !== "upload" && <span className="eyebrow">{session ? "ACCOUNT" : "LOG IN"}</span>}<strong>{session ? view === "upload" ? "Upload Archive" : profile?.name || profile?.email : "Make Squiggles yours"}</strong></div><button aria-label="Close account" onClick={onClose}>×</button></header>
    {loading && <p>Checking your session…</p>}
    {error && <p className="account-error">{error}</p>}
    {!loading && !session && <><p>An account lets Squiggles compile your activity archive, keep maps available across devices, publish a stable link, and count views. Strava exports are currently supported.</p><button className="account-primary" disabled={!config} onClick={() => config && void beginGoogleLogin(config)}>Log in with Google</button></>}
    {profile && <>
      {view === "account" && <div className={`approval-status ${profile.status}`}><span aria-hidden="true" />Access {profile.status}{profile.role === "admin" ? " · admin" : ""}</div>}
      {profile.status === "pending" && <p>Your first login worked. An administrator still needs to approve this account before private data or uploads are available.</p>}
      {profile.status === "approved" && view === "account" && <section className="account-stats"><div><strong>{profile.stats?.activityCount.toLocaleString() ?? "0"}</strong><span>processed activities</span></div><div><strong>{profile.stats?.datasetCount.toLocaleString() ?? "0"}</strong><span>processed datasets</span></div><div><strong>{bytes(profile.stats?.curatedBytes ?? 0)}</strong><span>curated data</span></div><div><strong>{bytes(profile.stats?.uploadedBytes ?? 0)}</strong><span>uploaded source</span></div><div><strong>{profile.stats?.publishedViews.toLocaleString() ?? "0"}</strong><span>published views</span></div><div><strong>{profile.stats?.publishedMaps.toLocaleString() ?? "0"}</strong><span>published maps</span></div></section>}
      {profile.status === "approved" && view === "upload" && <section className="account-upload"><p>Upload an activity archive. Strava ZIP exports are currently supported; media is skipped.</p><label className={`archive-dropzone ${uploading ? "uploading" : ""}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void selectArchive(event.dataTransfer.files[0]); }}><strong>{uploading ? `Uploading ${Math.round(progress * 100)}%` : "Drop an activity ZIP here"}</strong><span>or choose a file</span><input type="file" accept=".zip,application/zip" disabled={uploading} onChange={event => void selectArchive(event.target.files?.[0])} /></label>{uploads.map(upload => { const paused = pausedUpload === upload.filename && upload.status === "uploading"; return <div className="upload-row" key={upload.id}><span>{upload.filename}{paused ? <small>Upload interrupted. Select this ZIP again to resume.</small> : upload.statusDetail && <small>{upload.statusDetail}</small>}</span><strong>{paused ? "paused" : upload.status}</strong></div>; })}</section>}
      {profile.role === "admin" && view === "account" && <section className="admin-console"><header><strong>Admin · users</strong><span>{adminUsers.length} accounts</span></header><div className="admin-users">{adminUsers.length === 0 && <div className="admin-empty">No users yet.</div>}{adminUsers.map(user => <article className="admin-user" key={user.subject}><div className="admin-user-top"><div className="admin-user-identity"><strong>{user.name || user.email || user.subject}</strong><span>{user.email || user.subject}</span></div><span className={`admin-user-status ${user.status}`}>{user.status}</span></div><div className="admin-user-meta"><span>{user.phase}</span><span>{user.uploads} upload{user.uploads === 1 ? "" : "s"}</span><span>{user.activityCount.toLocaleString()} activities</span><span>{user.publishedViews.toLocaleString()} views</span></div>{user.latestUpload && <div className="admin-user-detail">Latest: {user.latestUpload.filename} · {user.latestUpload.status}{user.latestUpload.progressTotal > 0 ? ` · ${user.latestUpload.progressCompleted}/${user.latestUpload.progressTotal}` : ""}{user.latestUpload.statusDetail ? ` · ${user.latestUpload.statusDetail}` : ""}</div>}<div className="admin-user-links">{user.mapUrl && <a href={user.mapUrl} target="_blank" rel="noreferrer">Open map</a>}{user.publishedUrl && user.publishedUrl !== user.mapUrl && <a href={user.publishedUrl} target="_blank" rel="noreferrer">Published map</a>}{user.datasetId && <span className="admin-user-detail">dataset {user.datasetId.slice(0, 8)}</span>}</div>{user.role !== "admin" && <div className="admin-user-actions"><button className={user.status === "approved" ? "active" : ""} disabled={adminLoading} onClick={() => void changeAccess(user, "approved")}>Grant access</button><button className={user.status === "pending" ? "active" : ""} disabled={adminLoading} onClick={() => void changeAccess(user, "pending")}>Pending</button><button className={user.status === "rejected" ? "active" : ""} disabled={adminLoading} onClick={() => void changeAccess(user, "rejected")}>Reject</button></div>}</article>)}</div></section>}
      {view === "account" && <div className="account-actions"><button onClick={signOut}>Sign out</button><button className="danger-button" onClick={() => void removeAccount()}>Delete account</button></div>}
    </>}
  </section>;
}
