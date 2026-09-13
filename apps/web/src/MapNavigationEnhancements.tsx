import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { loadRuntimeConfig, loadSession } from "./auth";
import { loadMapNavigation, type MapNavigation, type RecentMap } from "./mapIdentity";

function accountMenu() {
  return document.querySelector<HTMLElement>('nav.account-menu[aria-label="Map and account navigation"]');
}

function mapLabel(map: RecentMap) {
  return map.ownerDisplayName || "Shared map";
}

function recentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(date);
}

function Avatar({ name, url }: { name: string; url?: string }) {
  return <span className="maps-dialog-avatar">{url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : name.slice(0, 1).toUpperCase()}</span>;
}

export function MapNavigationEnhancements() {
  const [menu, setMenu] = useState<HTMLElement | null>(() => accountMenu());
  const [navigation, setNavigation] = useState<MapNavigation | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    const session = loadSession();
    if (!session) { setNavigation(null); return; }
    const config = await loadRuntimeConfig();
    if (!config) return;
    setNavigation(await loadMapNavigation(config, session));
  };

  useEffect(() => {
    const update = () => setMenu(previous => {
      const next = accountMenu();
      return previous === next ? previous : next;
    });
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menu) return;
    void refresh().catch(() => undefined);
  // Refresh whenever the account menu is mounted; it is also the natural point where users expect current recents.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setRecentOpen(false); setShareOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const currentPath = window.location.pathname;
  const ownMap = navigation?.myMap ?? null;
  const viewingOwnMap = ownMap?.url === currentPath;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (navigation?.recentMaps ?? []).filter(map => {
      if (!needle) return true;
      return `${map.ownerDisplayName} ${map.mapId}`.toLowerCase().includes(needle);
    });
  }, [navigation?.recentMaps, query]);

  const canonicalShareUrl = ownMap ? new URL(ownMap.url, window.location.origin).toString() : "";
  const copyShareUrl = async () => {
    if (!canonicalShareUrl) return;
    await navigator.clipboard.writeText(canonicalShareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const nativeShare = async () => {
    if (!canonicalShareUrl || !navigator.share) return;
    await navigator.share({ title: "Squiggles map", url: canonicalShareUrl });
  };

  return <>
    {menu && navigation && createPortal(<section className="map-navigation-actions" aria-label="Map actions">
      <button onClick={() => { setRecentOpen(true); setQuery(""); }}>
        Recent maps{navigation.recentMaps.length ? ` (${navigation.recentMaps.length})` : ""}…
      </button>
      {viewingOwnMap && <button onClick={() => setShareOpen(true)}>Share map</button>}
    </section>, menu)}

    {recentOpen && <div className="maps-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setRecentOpen(false); }}>
      <section className="maps-dialog" role="dialog" aria-modal="true" aria-label="Recent maps">
        <header><div><span className="eyebrow">MAPS</span><strong>Recent maps</strong></div><button aria-label="Close recent maps" onClick={() => setRecentOpen(false)}>×</button></header>
        <label className="maps-search"><span>Search</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search people or map ID" /></label>
        <div className="maps-list">
          {ownMap && (!query || "my map".includes(query.trim().toLowerCase())) && <a className="maps-row own" href={ownMap.url}><Avatar name={ownMap.ownerDisplayName || "M"} url={ownMap.ownerAvatarUrl} /><span><strong>My map</strong><small>{ownMap.ownerDisplayName}</small></span><em>Yours</em></a>}
          {filtered.map(map => <a className="maps-row" href={map.url} key={map.mapId}><Avatar name={mapLabel(map)} url={map.ownerAvatarUrl} /><span><strong>{mapLabel(map)}</strong><small>{map.mapId}</small></span><em>{recentDate(map.lastViewedAt)}</em></a>)}
          {!filtered.length && !ownMap && <p className="maps-empty">No recent maps yet. Maps you explicitly open will appear here.</p>}
          {!filtered.length && ownMap && query && !"my map".includes(query.trim().toLowerCase()) && <p className="maps-empty">No maps match “{query}”.</p>}
        </div>
      </section>
    </div>}

    {shareOpen && ownMap && <div className="maps-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShareOpen(false); }}>
      <section className="maps-dialog share-map-dialog" role="dialog" aria-modal="true" aria-label="Share map">
        <header><div><span className="eyebrow">SHARE</span><strong>Share your map</strong></div><button aria-label="Close share map" onClick={() => setShareOpen(false)}>×</button></header>
        <p>Anyone with this link can view your map. The URL stays the same when you upload or recompile your archive.</p>
        <div className="share-map-url"><input aria-label="Map URL" readOnly value={canonicalShareUrl} /><button onClick={() => void copyShareUrl()}>{copied ? "Copied" : "Copy link"}</button></div>
        {typeof navigator.share === "function" && <button className="share-native" onClick={() => void nativeShare()}>Share…</button>}
      </section>
    </div>}
  </>;
}
