import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { clearSession, identityFromSession, loadRuntimeConfig, loadSession } from "./auth";
import { likeMap, loadMapNavigation, unlikeMap, type MapNavigation } from "./mapIdentity";
import { loadTabs, mapStorageScope } from "./storage";

type IconName = "map" | "star" | "user" | "upload" | "save" | "share" | "logout" | "heart" | "view" | "check";

function Icon({ name }: { name: IconName }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "map") return <svg {...common}><path d="m3 6 5-3 8 3 5-3v15l-5 3-8-3-5 3Z"/><path d="M8 3v15M16 6v15"/></svg>;
  if (name === "star") return <svg {...common}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.6-4 2.8-6 6.5-6s5.9 2 6.5 6"/></svg>;
  if (name === "upload") return <svg {...common}><path d="M12 16V5m0 0L8 9m4-4 4 4"/><path d="M5 13a4 4 0 0 0 .5 8h13a3.5 3.5 0 0 0 .5-7 7 7 0 0 0-13.4-2"/></svg>;
  if (name === "save") return <svg {...common}><path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M5 18v3h14v-3"/></svg>;
  if (name === "share") return <svg {...common}><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="m8 11 8-4m-8 6 8 4"/></svg>;
  if (name === "logout") return <svg {...common}><path d="M10 4H5v16h5"/><path d="M13 8l4 4-4 4m4-4H9"/></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.5 9.5c0 5-8.5 10-8.5 10s-8.5-5-8.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8.5 2.5Z"/></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>;
}

function nativeOwnerButton() {
  return document.querySelector<HTMLButtonElement>("button.map-identity-button");
}

function nativeQueryButton() {
  return document.querySelector<HTMLButtonElement>("button.mobile-query-title");
}

function currentMapId() {
  return /^\/m\/([0-9a-f-]{36})\/?$/i.exec(window.location.pathname)?.[1] ?? null;
}

function Avatar({ name, url, className = "maps-dialog-avatar" }: { name: string; url?: string; className?: string }) {
  return <span className={className}>{url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : name.slice(0, 1).toUpperCase()}</span>;
}

function runNativeAccountAction(labels: string[]) {
  const trigger = nativeOwnerButton();
  if (!trigger) return;
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  window.setTimeout(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('nav.account-menu[aria-label="Map and account navigation"] button')];
    buttons.find(button => labels.includes(button.textContent?.trim() ?? ""))?.click();
  }, 0);
}

export function MapNavigationEnhancements() {
  const [topbar, setTopbar] = useState<HTMLElement | null>(() => document.querySelector<HTMLElement>("header.topbar"));
  const [navigation, setNavigation] = useState<MapNavigation | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [domVersion, setDomVersion] = useState(0);
  const [pendingLike, setPendingLike] = useState(false);

  const session = loadSession();
  const sessionIdentity = identityFromSession(session);

  const refresh = async () => {
    if (!session) { setNavigation(null); return; }
    const config = await loadRuntimeConfig();
    if (!config) return;
    setNavigation(await loadMapNavigation(config, session));
  };

  useEffect(() => {
    const update = () => {
      const next = document.querySelector<HTMLElement>("header.topbar");
      setTopbar(previous => previous === next ? previous : next);
      setDomVersion(version => version + 1);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-expanded"] });
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => { void refresh().catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setContextOpen(false); setSettingsOpen(false); setFavoritesOpen(false); setShareOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const path = window.location.pathname;
  const mapId = currentMapId();
  const viewingOwnMap = Boolean(navigation?.myMap?.url === path || (mapId && navigation?.myMap?.mapId === mapId));
  const nativeOwner = nativeOwnerButton();
  const nativeOwnerName = nativeOwner?.querySelector("strong")?.textContent?.trim() || "Shared map";
  const ownerName = viewingOwnMap ? (navigation?.myMap?.ownerDisplayName || sessionIdentity.name || sessionIdentity.email || "My map") : nativeOwnerName;
  const ownerAvatarUrl = viewingOwnMap
    ? navigation?.myMap?.ownerAvatarUrl || sessionIdentity.picture
    : nativeOwner?.querySelector<HTMLImageElement>(".map-owner-avatar img")?.src;
  const currentViewName = nativeQueryButton()?.textContent?.trim() || "Map";
  const views = useMemo(() => loadTabs(mapStorageScope()).map(tab => ({ id: tab.id, title: tab.title })), [domVersion, path]);
  const favorite = Boolean(mapId && navigation?.recentMaps.some(map => map.mapId === mapId));

  const filteredFavorites = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (navigation?.recentMaps ?? []).filter(map => !needle || `${map.ownerDisplayName} ${map.mapId}`.toLowerCase().includes(needle));
  }, [navigation?.recentMaps, query]);

  const setFavorite = async () => {
    if (!mapId || viewingOwnMap || pendingLike) return;
    if (!session) {
      document.querySelector<HTMLButtonElement>("button.login-button")?.click();
      return;
    }
    setPendingLike(true);
    try {
      const config = await loadRuntimeConfig();
      if (!config) return;
      if (favorite) await unlikeMap(config, session, mapId);
      else await likeMap(config, session, mapId);
      await refresh();
    } finally { setPendingLike(false); }
  };

  const chooseView = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.location.assign(url);
  };

  const canonicalShareUrl = mapId ? new URL(`/m/${mapId}`, window.location.origin).toString() : window.location.href;
  const copyShareUrl = async () => {
    await navigator.clipboard.writeText(canonicalShareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const nativeShare = async () => {
    if (!navigator.share) return;
    await navigator.share({ title: `${ownerName} · Squiggles`, url: canonicalShareUrl });
  };

  const menu = <>
    {navigation?.myMap && <a href={navigation.myMap.url}><Icon name="map"/><span>My map</span></a>}
    <button onClick={() => { setFavoritesOpen(true); setSettingsOpen(false); setQuery(""); }}><Icon name="star"/><span>Favorites</span></button>
    <button onClick={() => { setSettingsOpen(false); runNativeAccountAction(["Account"]); }}><Icon name="user"/><span>Account</span></button>
    <button onClick={() => { setSettingsOpen(false); runNativeAccountAction(["Upload Archive"]); }}><Icon name="upload"/><span>Upload</span></button>
    {viewingOwnMap && <button onClick={() => { setSettingsOpen(false); runNativeAccountAction(["Save view"]); }}><Icon name="save"/><span>Save</span></button>}
    <button onClick={() => { setShareOpen(true); setSettingsOpen(false); }}><Icon name="share"/><span>Share</span></button>
    <button onClick={() => { clearSession(); window.location.assign("/"); }}><Icon name="logout"/><span>Logout</span></button>
  </>;

  return <>
    <span className="map-navigation-redesign-marker" hidden />
    {topbar && createPortal(<>
      {mapId && <button className={`map-context-trigger ${contextOpen ? "active" : ""}`} aria-label={`Open ${ownerName} map views`} aria-expanded={contextOpen} onClick={() => { setContextOpen(open => !open); setSettingsOpen(false); }}>
        <Avatar name={ownerName} url={ownerAvatarUrl} className="map-context-avatar" />
        <strong>{currentViewName}</strong><span className="map-context-chevron" aria-hidden="true">⌄</span>
      </button>}
      {session && <button className={`app-settings-trigger ${settingsOpen ? "active" : ""}`} aria-label="Open account menu" aria-expanded={settingsOpen} onClick={() => { setSettingsOpen(open => !open); setContextOpen(false); }}><span aria-hidden="true">⋮</span></button>}
    </>, topbar)}

    {contextOpen && mapId && <div className="map-context-popover" role="dialog" aria-label="Map owner and views">
      <div className="map-owner-heading"><Avatar name={ownerName} url={ownerAvatarUrl}/><span><strong>{ownerName}</strong><small>Owner of this map</small></span></div>
      {!viewingOwnMap && <button className={`map-like-action ${favorite ? "active" : ""}`} disabled={pendingLike} onClick={() => void setFavorite()}><Icon name="heart"/><span><strong>{favorite ? "Liked" : "Like map"}</strong><small>{favorite ? "Remove from favorites" : session ? "Add to favorites" : "Log in to add to favorites"}</small></span></button>}
      <div className="map-view-list">{views.map(view => <button className={view.title === currentViewName ? "active" : ""} key={view.id} onClick={() => { setContextOpen(false); if (view.title !== currentViewName) chooseView(view.id); }}><Icon name="view"/><span>{view.title}</span>{view.title === currentViewName && <Icon name="check"/>}</button>)}</div>
    </div>}

    {settingsOpen && <nav className="simplified-account-menu" aria-label="Account navigation">{menu}</nav>}

    {favoritesOpen && <div className="maps-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFavoritesOpen(false); }}>
      <section className="maps-dialog" role="dialog" aria-modal="true" aria-label="Favorites">
        <header><div><span className="eyebrow">MAPS</span><strong>Favorites</strong></div><button aria-label="Close favorites" onClick={() => setFavoritesOpen(false)}>×</button></header>
        <label className="maps-search"><span>Search</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search favorites" /></label>
        <div className="maps-list">
          {filteredFavorites.map(map => <a className="maps-row" href={map.url} key={map.mapId}><Avatar name={map.ownerDisplayName} url={map.ownerAvatarUrl}/><span><strong>{map.ownerDisplayName}</strong><small>{map.mapId}</small></span></a>)}
          {!filteredFavorites.length && <p className="maps-empty">{query ? `No favorites match “${query}”.` : "No favorites yet. Like someone’s map to keep it here."}</p>}
        </div>
      </section>
    </div>}

    {shareOpen && <div className="maps-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShareOpen(false); }}>
      <section className="maps-dialog share-map-dialog" role="dialog" aria-modal="true" aria-label="Share map">
        <header><div><span className="eyebrow">SHARE</span><strong>Share map</strong></div><button aria-label="Close share map" onClick={() => setShareOpen(false)}>×</button></header>
        <p>Anyone with this link can view this map. The map URL stays stable across archive updates.</p>
        <div className="share-map-url"><input aria-label="Map URL" readOnly value={canonicalShareUrl} /><button onClick={() => void copyShareUrl()}>{copied ? "Copied" : "Copy link"}</button></div>
        {typeof navigator.share === "function" && <button className="share-native" onClick={() => void nativeShare()}>Share…</button>}
      </section>
    </div>}
  </>;
}
