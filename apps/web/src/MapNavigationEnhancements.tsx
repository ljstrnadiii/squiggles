import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { beginGoogleLogin, clearSession, identityFromSession, loadRuntimeConfig, loadSession } from "./auth";
import type { QueryTab } from "./contracts";
import { likeMap, loadMapNavigation, unlikeMap, type MapNavigation } from "./mapIdentity";
import { createMapView, editMapView, mapViewNavigationState, openMapStatistics, openMapTable, selectMapView, subscribeMapViewNavigation } from "./mapViewController";
import { loadPublishedView } from "./publishing";
import { loadTabs, mapStorageScope, saveTabs } from "./storage";

type IconName = "map" | "star" | "user" | "upload" | "save" | "share" | "logout" | "heart" | "edit";
type SaveState = "saved" | "view-dirty" | "settings-dirty";

function Icon({ name }: { name: IconName }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "map") return <svg {...common}><path d="m3 6 5-3 8 3 5-3v15l-5 3-8-3-5 3Z"/><path d="M8 3v15M16 6v15"/></svg>;
  if (name === "star") return <svg {...common}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.6-4 2.8-6 6.5-6s5.9 2 6.5 6"/></svg>;
  if (name === "upload") return <svg {...common}><path d="M12 16V5m0 0L8 9m4-4 4 4"/><path d="M5 13a4 4 0 0 0 .5 8h13a3.5 3.5 0 0 0 .5-7 7 7 0 0 0-13.4-2"/></svg>;
  if (name === "save") return <svg {...common}><path d="M5 3h12l2 2v16H5Z"/><path d="M8 3v6h8V3M8 14h8v7H8Z"/></svg>;
  if (name === "share") return <svg {...common}><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="m8 11 8-4m-8 6 8 4"/></svg>;
  if (name === "logout") return <svg {...common}><path d="M10 4H5v16h5"/><path d="M13 8l4 4-4 4m4-4H9"/></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.5 9.5c0 5-8.5 10-8.5 10s-8.5-5-8.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8.5 2.5Z"/></svg>;
  return <svg {...common}><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>;
}

function nativeOwnerButton() {
  return document.querySelector<HTMLButtonElement>("button.map-identity-button");
}

function currentMapId() {
  return /^\/p\/([a-z0-9]{8})\/?$/i.exec(window.location.pathname)?.[1] ?? null;
}

function mapDefinitionSignature(tabs: QueryTab[]) {
  return JSON.stringify(tabs.map(tab => ({ id: tab.id, title: tab.title, sql: tab.sql, style: tab.style, spatialFilter: tab.spatialFilter })));
}

function rounded(value: number | undefined, digits: number) {
  return Number.isFinite(value) ? Number(value!.toFixed(digits)) : null;
}

function mapViewSignature(tabs: QueryTab[]) {
  return JSON.stringify(tabs.map(tab => ({
    id: tab.id,
    mapState: tab.mapState ? {
      longitude: rounded(tab.mapState.longitude, 5),
      latitude: rounded(tab.mapState.latitude, 5),
      zoom: rounded(tab.mapState.zoom, 4),
      pitch: rounded(tab.mapState.pitch, 2),
      bearing: rounded(tab.mapState.bearing, 2),
    } : null,
  })));
}

function mapPersistedSignature(tabs: QueryTab[]) {
  return JSON.stringify({ definition: mapDefinitionSignature(tabs), view: mapViewSignature(tabs) });
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
  const [, setDomVersion] = useState(0);
  const [pendingLike, setPendingLike] = useState(false);
  const [savedDefinitionSignature, setSavedDefinitionSignature] = useState<string | null>(null);
  const [savedViewSignature, setSavedViewSignature] = useState<string | null>(null);
  const [currentDefinitionSignature, setCurrentDefinitionSignature] = useState(() => mapDefinitionSignature(loadTabs(mapStorageScope())));
  const [currentViewSignature, setCurrentViewSignature] = useState(() => mapViewSignature(loadTabs(mapStorageScope())));
  const [saving, setSaving] = useState(false);
  const viewNavigation = useSyncExternalStore(subscribeMapViewNavigation, mapViewNavigationState, mapViewNavigationState);

  const session = loadSession();
  const sessionIdentity = identityFromSession(session);

  const refresh = async () => {
    if (!session) { setNavigation(null); return; }
    const config = await loadRuntimeConfig();
    if (!config) return;
    setNavigation(await loadMapNavigation(config, session));
  };

  const login = async () => {
    const config = await loadRuntimeConfig();
    if (config) await beginGoogleLogin(config);
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
  const canEditViews = !mapId || viewingOwnMap;
  const nativeOwner = nativeOwnerButton();
  const nativeOwnerName = nativeOwner?.querySelector("strong")?.textContent?.trim() || "Shared map";
  const ownerName = viewingOwnMap ? (navigation?.myMap?.ownerDisplayName || sessionIdentity.name || sessionIdentity.email || "My map") : nativeOwnerName;
  const ownerAvatarUrl = viewingOwnMap
    ? navigation?.myMap?.ownerAvatarUrl || sessionIdentity.picture
    : nativeOwner?.querySelector<HTMLImageElement>(".map-owner-avatar img")?.src;
  const fallbackViews = loadTabs(mapStorageScope()).map(tab => ({ id: tab.id, title: tab.title }));
  const views = viewNavigation.views.length ? viewNavigation.views : fallbackViews;
  const currentViewId = viewNavigation.activeId ?? new URLSearchParams(window.location.search).get("tab") ?? views[0]?.id ?? null;
  const currentViewName = views.find(view => view.id === currentViewId)?.title ?? views[0]?.title ?? "Map";
  const favorite = Boolean(mapId && navigation?.recentMaps.some(map => map.mapId === mapId));
  const settingsDirty = savedDefinitionSignature !== null && currentDefinitionSignature !== savedDefinitionSignature;
  const viewDirty = !settingsDirty && savedViewSignature !== null && currentViewSignature !== savedViewSignature;
  const saveState: SaveState = settingsDirty ? "settings-dirty" : viewDirty ? "view-dirty" : "saved";

  useEffect(() => {
    if (!viewingOwnMap || !mapId) {
      setSavedDefinitionSignature(null);
      setSavedViewSignature(null);
      return;
    }
    let cancelled = false;
    void loadRuntimeConfig()
      .then(config => config ? loadPublishedView(config, mapId) : null)
      .then(saved => {
        if (cancelled || !saved) return;
        const scope = mapStorageScope();
        saveTabs(saved.tabs, scope);
        setSavedDefinitionSignature(mapDefinitionSignature(saved.tabs));
        setSavedViewSignature(mapViewSignature(saved.tabs));
        setCurrentDefinitionSignature(mapDefinitionSignature(saved.tabs));
        setCurrentViewSignature(mapViewSignature(saved.tabs));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [mapId, viewingOwnMap]);

  useEffect(() => {
    if (!viewingOwnMap) return;
    const update = () => {
      const tabs = loadTabs(mapStorageScope());
      setCurrentDefinitionSignature(mapDefinitionSignature(tabs));
      setCurrentViewSignature(mapViewSignature(tabs));
    };
    update();
    const timer = window.setInterval(update, 400);
    return () => window.clearInterval(timer);
  }, [mapId, viewingOwnMap]);

  const filteredFavorites = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (navigation?.recentMaps ?? []).filter(map => !needle || `${map.ownerDisplayName} ${map.mapId}`.toLowerCase().includes(needle));
  }, [navigation?.recentMaps, query]);

  const setFavorite = async () => {
    if (!mapId || viewingOwnMap || pendingLike) return;
    if (!session) {
      await login();
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

  const saveMap = async () => {
    if (!viewingOwnMap || !mapId || saving) return;
    const target = mapPersistedSignature(loadTabs(mapStorageScope()));
    setSaving(true);
    runNativeAccountAction(["Save view"]);
    try {
      const config = await loadRuntimeConfig();
      if (!config) return;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 350));
        const saved = await loadPublishedView(config, mapId);
        setSavedDefinitionSignature(mapDefinitionSignature(saved.tabs));
        setSavedViewSignature(mapViewSignature(saved.tabs));
        if (mapPersistedSignature(saved.tabs) === target) break;
      }
    } catch {
      // The native save path owns user-facing errors; leave the dirty state unchanged.
    } finally { setSaving(false); }
  };

  const canonicalShareUrl = mapId ? new URL(`/p/${mapId}`, window.location.origin).toString() : window.location.href;
  const copyShareUrl = async () => {
    await navigator.clipboard.writeText(canonicalShareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const nativeShare = async () => {
    if (!navigator.share) return;
    await navigator.share({ title: `${ownerName} · Squiggles`, url: canonicalShareUrl });
  };

  const loginFromMenu = () => {
    setSettingsOpen(false);
    void login();
  };

  const menu = <>
    {navigation?.myMap
      ? <a href={navigation.myMap.url}><Icon name="map"/><span>My map</span></a>
      : !session && <button onClick={loginFromMenu}><Icon name="map"/><span>My map</span></button>}
    <button onClick={() => {
      if (!session) { loginFromMenu(); return; }
      setFavoritesOpen(true); setSettingsOpen(false); setQuery("");
    }}><Icon name="star"/><span>Favorites</span></button>
    <button onClick={() => {
      if (!session) { loginFromMenu(); return; }
      setSettingsOpen(false); runNativeAccountAction(["Account"]);
    }}><Icon name="user"/><span>Account</span></button>
    <button onClick={() => {
      if (!session) { loginFromMenu(); return; }
      setSettingsOpen(false); runNativeAccountAction(["Upload Archive"]);
    }}><Icon name="upload"/><span>Upload</span></button>
    {session
      ? <button onClick={() => { clearSession(); window.location.assign("/"); }}><Icon name="logout"/><span>Logout</span></button>
      : <button onClick={loginFromMenu}><Icon name="user"/><span>Log in</span></button>}
  </>;

  const saveExplanation = saving
    ? "Saving map…"
    : saveState === "settings-dirty"
      ? "Query or map settings changed — save this map"
      : saveState === "view-dirty"
        ? "View changed — save to make this perspective the default"
        : "Saved — map settings and view are up to date";

  return <>
    <span className="map-navigation-redesign-marker" hidden />
    {topbar && createPortal(<>
      {views.length > 0 && <button className={`map-context-trigger ${contextOpen ? "active" : ""}`} aria-label={mapId ? `Open ${ownerName} map views` : "Open map views"} aria-expanded={contextOpen} onClick={() => { setContextOpen(open => !open); setSettingsOpen(false); }}>
        {mapId ? <Avatar name={ownerName} url={ownerAvatarUrl} className="map-context-avatar" /> : <span className="map-context-avatar map-context-generic"><Icon name="map"/></span>}
        <strong>{currentViewName}</strong>
      </button>}
      {mapId && viewingOwnMap && <div className="map-owner-actions">
        <button className={`map-owner-icon map-save-icon ${saveState}`} aria-label={saveExplanation} title={saveExplanation} disabled={saving} onClick={() => void saveMap()}><Icon name="save"/></button>
        <button className="map-owner-icon" aria-label="Share map" title="Share this map" onClick={() => { setShareOpen(true); setSettingsOpen(false); setContextOpen(false); }}><Icon name="share"/></button>
      </div>}
      <button className={`app-settings-trigger ${settingsOpen ? "active" : ""}`} aria-label="Open account menu" aria-expanded={settingsOpen} onClick={() => { setSettingsOpen(open => !open); setContextOpen(false); }}><span aria-hidden="true">⋮</span></button>
    </>, topbar)}

    {contextOpen && views.length > 0 && <div className="map-context-popover" role="dialog" aria-label="Map owner and views">
      {mapId && <div className="map-owner-heading"><Avatar name={ownerName} url={ownerAvatarUrl}/><span><strong>{ownerName}</strong><small>Owner of this map</small></span></div>}
      {mapId && !viewingOwnMap && <button className={`map-like-action ${favorite ? "active" : ""}`} disabled={pendingLike} onClick={() => void setFavorite()}><Icon name="heart"/><span><strong>{favorite ? "Liked" : "Like map"}</strong><small>{favorite ? "Remove from favorites" : session ? "Add to favorites" : "Log in to add to favorites"}</small></span></button>}
      <div className="map-view-list">
        {views.map(view => {
          const active = view.id === currentViewId;
          return <div className={`map-view-row ${active ? "active" : ""}`} key={view.id}>
            <button className="map-view-select" onClick={() => { setContextOpen(false); if (!active) selectMapView(view.id); }}>{view.title}</button>
            {canEditViews && active && <button className="map-view-edit" aria-label="Edit current map" onClick={() => { setContextOpen(false); editMapView(view.id); }}><Icon name="edit"/></button>}
          </div>;
        })}
        {canEditViews && <button className="map-new-view" onClick={() => { setContextOpen(false); createMapView(); }}>+ New map</button>}
      </div>
      <div className="map-view-tools">
        <button onClick={() => { setContextOpen(false); openMapStatistics(); }}>Statistics</button>
        <button onClick={() => { setContextOpen(false); openMapTable(); }}>Table</button>
      </div>
    </div>}

    {settingsOpen && <nav className="simplified-account-menu" aria-label="Account navigation">{menu}</nav>}

    {favoritesOpen && <section className="maps-dialog maps-pane" role="dialog" aria-label="Favorites">
      <header><div><span className="eyebrow">MAPS</span><strong>Favorites</strong></div><button aria-label="Close favorites" onClick={() => setFavoritesOpen(false)}>×</button></header>
      <label className="maps-search"><span>Search</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search favorites" /></label>
      <div className="maps-list">
        {filteredFavorites.map(map => <a className="maps-row" href={map.url} key={map.mapId}><Avatar name={map.ownerDisplayName} url={map.ownerAvatarUrl}/><span><strong>{map.ownerDisplayName}</strong><small>{map.mapId}</small></span></a>)}
        {!filteredFavorites.length && <p className="maps-empty">{query ? `No favorites match “${query}”.` : "No favorites yet. Like someone’s map to keep it here."}</p>}
      </div>
    </section>}

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
