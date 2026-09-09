import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { renderingDiagnostics, subscribeRenderingDiagnostics, type RenderingDiagnosticState } from "./diagnosticState";

type PanelTargets = {
  table: HTMLElement | null;
  toolbar: HTMLElement | null;
  logoMenu: HTMLElement | null;
  queryMenu: HTMLElement | null;
  detail: HTMLElement | null;
  systemSettings: HTMLElement | null;
};

type NetworkInformation = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

function targets(): PanelTargets {
  return {
    table: document.querySelector<HTMLElement>('section.activity-table[aria-label="Activity table"]'),
    toolbar: document.querySelector<HTMLElement>(
      'section.toolbar[aria-label="Query and map settings"]',
    ),
    logoMenu: document.querySelector<HTMLElement>(
      'nav.logo-menu[aria-label="Squiggles navigation"]',
    ),
    queryMenu: document.querySelector<HTMLElement>(
      'nav.mobile-menu[aria-label="Query navigation"]',
    ),
    detail: document.querySelector<HTMLElement>('aside.detail[aria-label="Activity detail"]'),
    systemSettings: document.querySelector<HTMLElement>('section.system-settings[aria-label="System settings"]'),
  };
}

function milliseconds(value: number) {
  return `${Math.max(0, value).toFixed(0)} ms`;
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

function isMobilePanelLayout() {
  return window.matchMedia?.("(max-width: 700px)").matches ?? window.innerWidth <= 700;
}

function closeActivityDetail() {
  document.querySelector<HTMLButtonElement>('aside.detail button[aria-label="Close detail"]')?.click();
}

function closeSystemSettings() {
  document.querySelector<HTMLButtonElement>('section.system-settings button[aria-label="Close system settings"]')?.click();
}

function diagnosticSnapshot() {
  const navigation = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const transferred = resources.reduce(
    (total, resource) => total + Math.max(0, resource.transferSize || 0),
    0,
  );
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;

  return {
    generatedAt: new Date().toISOString(),
    startup: {
      domInteractiveMs: navigation?.domInteractive ?? null,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      responseStartMs: navigation?.responseStart ?? null,
    },
    network: {
      resourceRequests: resources.length,
      transferredBytes: transferred,
      effectiveType: connection?.effectiveType ?? null,
      downlinkMbps: connection?.downlink ?? null,
      rttMs: connection?.rtt ?? null,
      saveData: connection?.saveData ?? null,
    },
    device: {
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    },
  };
}

function Diagnostics({ onClose }: { onClose: () => void }) {
  const snapshot = diagnosticSnapshot();
  const [rendering, setRendering] = useState<RenderingDiagnosticState | null>(renderingDiagnostics);

  useEffect(() => subscribeRenderingDiagnostics(setRendering), []);

  const copy = async () => {
    await navigator.clipboard?.writeText(JSON.stringify({ startup: snapshot, rendering }, null, 2));
  };

  return (
    <section className="enhancement-diagnostics" aria-label="Diagnostics">
      <header>
        <div>
          <span>DIAGNOSTICS</span>
          <strong>Startup, device, and rendering</strong>
        </div>
        <button aria-label="Close diagnostics" onClick={onClose}>
          ×
        </button>
      </header>
      <table>
        <tbody>
          <tr>
            <th>DOM interactive</th>
            <td>
              {snapshot.startup.domInteractiveMs == null
                ? "—"
                : milliseconds(snapshot.startup.domInteractiveMs)}
            </td>
          </tr>
          <tr>
            <th>DOMContentLoaded</th>
            <td>
              {snapshot.startup.domContentLoadedMs == null
                ? "—"
                : milliseconds(snapshot.startup.domContentLoadedMs)}
            </td>
          </tr>
          <tr>
            <th>Load event</th>
            <td>
              {snapshot.startup.loadEventMs == null
                ? "—"
                : milliseconds(snapshot.startup.loadEventMs)}
            </td>
          </tr>
          <tr>
            <th>First response</th>
            <td>
              {snapshot.startup.responseStartMs == null
                ? "—"
                : milliseconds(snapshot.startup.responseStartMs)}
            </td>
          </tr>
          <tr>
            <th>Resource requests</th>
            <td>{snapshot.network.resourceRequests}</td>
          </tr>
          <tr>
            <th>Transferred</th>
            <td>{bytes(snapshot.network.transferredBytes)}</td>
          </tr>
          <tr>
            <th>Connection</th>
            <td>
              {snapshot.network.effectiveType ?? "—"}
              {snapshot.network.downlinkMbps == null
                ? ""
                : ` · ${snapshot.network.downlinkMbps} Mbps`}
              {snapshot.network.rttMs == null ? "" : ` · ${snapshot.network.rttMs} ms RTT`}
            </td>
          </tr>
          <tr>
            <th>Viewport</th>
            <td>
              {snapshot.device.viewport} · {snapshot.device.devicePixelRatio.toFixed(2)}× DPR
            </td>
          </tr>
          <tr>
            <th>CPU threads</th>
            <td>{snapshot.device.hardwareConcurrency ?? "—"}</td>
          </tr>
          <tr>
            <th>User agent</th>
            <td className="diagnostics-user-agent">{snapshot.device.userAgent}</td>
          </tr>
        </tbody>
      </table>
      <h3>Rendering</h3>
      <table>
        <tbody>
          <tr><th>LOD</th><td>{rendering?.lod == null ? "—" : rendering.lod}</td></tr>
          <tr><th>Requested LOD</th><td>{rendering?.diagnostics?.requestedLod ?? "—"}</td></tr>
          <tr><th>Vertices</th><td>{rendering ? `${rendering.vertexCount.toLocaleString()} / ${rendering.vertexBudget.toLocaleString()}` : "—"}</td></tr>
          <tr><th>Visible routes</th><td>{rendering?.visibleCount.toLocaleString() ?? "—"}</td></tr>
          <tr><th>Selected routes</th><td>{rendering?.selectedRoutes.toLocaleString() ?? "—"}</td></tr>
          <tr><th>Budget utilization</th><td>{rendering ? `${rendering.vertexBudget ? (rendering.vertexCount / rendering.vertexBudget * 100).toFixed(1) : 0}%` : "—"}</td></tr>
          <tr><th>Parquet bytes</th><td>{rendering ? `${bytes(rendering.scan.candidateBytes)} / ${bytes(rendering.scan.totalBytes)}` : "—"}</td></tr>
          <tr><th>Fragment bytes avoided</th><td>{rendering ? `${rendering.scan.totalBytes ? ((rendering.scan.totalBytes - rendering.scan.candidateBytes) / rendering.scan.totalBytes * 100).toFixed(1) : 0}%` : "—"}</td></tr>
          <tr><th>Row groups</th><td>{rendering ? `${rendering.scan.expectedRowGroupCount} expected / ${rendering.scan.candidateRowGroupCount} candidate / ${rendering.scan.totalRowGroupCount} total` : "—"}</td></tr>
          <tr><th>Row groups filtered</th><td>{rendering ? (rendering.scan.totalRowGroupCount - rendering.scan.expectedRowGroupCount).toLocaleString() : "—"}</td></tr>
          <tr><th>Activity rows kept</th><td>{rendering ? `${rendering.scan.keptRowCount.toLocaleString()} / ${rendering.scan.expectedRowCount.toLocaleString()}` : "—"}</td></tr>
          <tr><th>Read-to-kept efficiency</th><td>{rendering ? `${rendering.scan.expectedRowCount ? (rendering.scan.keptRowCount / rendering.scan.expectedRowCount * 100).toFixed(1) : 0}%` : "—"}</td></tr>
          <tr><th>GeoArrow buffers</th><td>{rendering ? bytes(rendering.geometryBufferBytes) : "—"}</td></tr>
          <tr><th>Raw vertex estimate</th><td>{rendering?.rawVertexEstimate.toLocaleString() ?? "—"}</td></tr>
          <tr><th>Planned vertex estimate</th><td>{rendering ? `${rendering.plannedVertexEstimate.toLocaleString()} / ${rendering.vertexBudget.toLocaleString()}` : "—"}</td></tr>
          <tr><th>Coordinate objects</th><td>0</td></tr>
          <tr><th>Render time</th><td>{rendering ? milliseconds(rendering.durationMs) : "—"}</td></tr>
          <tr><th>Cache</th><td>{rendering ? `${rendering.cache.hit ? "hit" : "miss"} · ${bytes(rendering.cache.bytes)}` : "—"}</td></tr>
          <tr><th>Cache batches</th><td>{rendering ? `${rendering.cache.entries} · ${rendering.cache.evictions} evicted` : "—"}</td></tr>
          <tr><th>Terrain segments</th><td>{rendering ? `${rendering.terrain.submittedSegments.toLocaleString()} / ${rendering.terrain.loadedSegments.toLocaleString()}` : "—"}</td></tr>
          <tr><th>Terrain tiles</th><td>{rendering?.terrain.tileCount.toLocaleString() ?? "—"}</td></tr>
          <tr><th>Segments avoided</th><td>{rendering ? `${rendering.terrain.loadedSegments * rendering.terrain.tileCount ? ((rendering.terrain.loadedSegments * rendering.terrain.tileCount - rendering.terrain.submittedSegments) / (rendering.terrain.loadedSegments * rendering.terrain.tileCount) * 100).toFixed(1) : 0}%` : "—"}</td></tr>
          <tr><th>Map view</th><td>{rendering?.mapView ?? "—"}</td></tr>
          <tr><th>Thickness</th><td>{rendering?.thickness ?? "—"}</td></tr>
          <tr><th>Route width</th><td>{rendering?.routeWidth ?? "—"}</td></tr>
          <tr><th>Selected width</th><td>{rendering?.selectedWidth ?? "—"}</td></tr>
          <tr><th>Heat vertices</th><td>{rendering?.heat.sourceVertices.toLocaleString() ?? "—"}</td></tr>
          <tr><th>Heat-colored routes</th><td>{rendering?.heat.scores.toLocaleString() ?? "—"}</td></tr>
          <tr><th>Heat cells</th><td>{rendering?.heat.cellCount.toLocaleString() ?? "—"}</td></tr>
          <tr><th>Heat preparation</th><td>{rendering ? milliseconds(rendering.heat.durationMs) : "—"}</td></tr>
          <tr><th>Heat UI slices</th><td>{rendering ? `${rendering.heat.slices} · ${rendering.heat.maxSliceMs.toFixed(1)} ms max` : "—"}</td></tr>
          <tr><th>Data view</th><td>{rendering?.dataView ?? "—"}</td></tr>
          <tr><th>Basemap</th><td>{rendering?.basemap ?? "—"}</td></tr>
        </tbody>
      </table>
      <div className="diagnostics-actions">
        <button className="diagnostics-copy" onClick={() => void copy()}>Copy</button>
      </div>
    </section>
  );
}

export function PanelEnhancements() {
  const [panels, setPanels] = useState<PanelTargets>(() => targets());
  const [tableExpanded, setTableExpanded] = useState(false);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const logoClicks = useRef<number[]>([]);

  const openDiagnostics = () => {
    window.dispatchEvent(new Event("squiggles:close-system-settings"));
    document.querySelector<HTMLButtonElement>('section.toolbar button[aria-label="Close query settings"]')?.click();
    if (isMobilePanelLayout()) closeActivityDetail();
    setDiagnosticsOpen(true);
  };

  useEffect(() => {
    document.querySelector(".app")?.classList.toggle("with-side-panel", diagnosticsOpen);
    return () => document.querySelector(".app")?.classList.remove("with-side-panel");
  }, [diagnosticsOpen]);

  useEffect(() => {
    const close = () => setDiagnosticsOpen(false);
    window.addEventListener("squiggles:close-diagnostics", close);
    return () => window.removeEventListener("squiggles:close-diagnostics", close);
  }, []);

  useEffect(() => {
    if (panels.toolbar && diagnosticsOpen) setDiagnosticsOpen(false);
  }, [diagnosticsOpen, panels.toolbar]);

  useEffect(() => {
    if (!isMobilePanelLayout()) return;
    if (panels.systemSettings) {
      setDiagnosticsOpen(false);
      if (panels.detail) closeActivityDetail();
      return;
    }
    if (panels.detail) {
      setDiagnosticsOpen(false);
      closeSystemSettings();
    }
  }, [panels.detail, panels.systemSettings]);

  useEffect(() => {
    const update = () =>
      setPanels((previous) => {
        const next = targets();
        const unchanged =
          previous.table === next.table &&
          previous.toolbar === next.toolbar &&
          previous.logoMenu === next.logoMenu &&
          previous.queryMenu === next.queryMenu &&
          previous.detail === next.detail &&
          previous.systemSettings === next.systemSettings;
        return unchanged ? previous : next;
      });

    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!panels.logoMenu) return;
    const logo = document.querySelector<HTMLButtonElement>("button.brand-button");
    if (!logo) return;

    const openAfterFiveTaps = () => {
      const now = performance.now();
      logoClicks.current = [...logoClicks.current.filter((time) => now - time < 2500), now];
      if (logoClicks.current.length < 5) return;
      logoClicks.current = [];
      openDiagnostics();
    };

    logo.addEventListener("click", openAfterFiveTaps);
    return () => logo.removeEventListener("click", openAfterFiveTaps);
  }, [panels.logoMenu]);

  useEffect(() => {
    if (!panels.queryMenu) return;
    const firstSection = panels.queryMenu.querySelector("section:first-child");
    const mapButtons = [
      ...(firstSection?.querySelectorAll<HTMLButtonElement>("button:not(:last-child)") ?? []),
    ].filter((button) => !button.classList.contains("active"));

    const reopenAfterSwitch = () => {
      window.setTimeout(() => {
        const title = document.querySelector<HTMLButtonElement>("button.mobile-query-title");
        if (title?.getAttribute("aria-expanded") !== "true") title?.click();
      }, 0);
    };

    mapButtons.forEach((button) => button.addEventListener("click", reopenAfterSwitch));
    return () =>
      mapButtons.forEach((button) => button.removeEventListener("click", reopenAfterSwitch));
  }, [panels.queryMenu]);

  useEffect(() => {
    if (!panels.table) setTableExpanded(false);
  }, [panels.table]);

  useEffect(() => {
    if (!panels.toolbar) setToolbarExpanded(false);
  }, [panels.toolbar]);

  useEffect(() => {
    panels.table?.toggleAttribute("data-panel-expanded", tableExpanded);
    return () => panels.table?.removeAttribute("data-panel-expanded");
  }, [panels.table, tableExpanded]);

  useEffect(() => {
    panels.toolbar?.toggleAttribute("data-panel-expanded", toolbarExpanded);
    return () => panels.toolbar?.removeAttribute("data-panel-expanded");
  }, [panels.toolbar, toolbarExpanded]);

  const tableHeader = panels.table?.querySelector("header");
  const toolbarHeader = panels.toolbar?.querySelector("header");

  return (
    <>
      {tableHeader &&
        createPortal(
          <button
            className="panel-expand"
            aria-label={
              tableExpanded ? "Exit full screen activity table" : "Open activity table full screen"
            }
            title={tableExpanded ? "Exit full screen" : "Full screen"}
            onClick={() => setTableExpanded((value) => !value)}
          >
            {tableExpanded ? "⊙" : "⛶"}
          </button>,
          tableHeader,
        )}
      {toolbarHeader &&
        createPortal(
          <button
            className="panel-expand"
            aria-label={
              toolbarExpanded ? "Exit full screen query settings" : "Open query settings full screen"
            }
            title={toolbarExpanded ? "Exit full screen" : "Full screen"}
            onClick={() => setToolbarExpanded((value) => !value)}
          >
            {toolbarExpanded ? "⊙" : "⛶"}
          </button>,
          toolbarHeader,
        )}
      {panels.logoMenu &&
        createPortal(
          <button onClick={openDiagnostics}>Diagnostics</button>,
          panels.logoMenu,
        )}
      {diagnosticsOpen &&
        createPortal(<Diagnostics onClose={() => setDiagnosticsOpen(false)} />, document.body)}
    </>
  );
}
