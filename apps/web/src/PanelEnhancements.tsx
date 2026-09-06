import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type PanelTargets = {
  table: HTMLElement | null;
  toolbar: HTMLElement | null;
  logoMenu: HTMLElement | null;
  queryMenu: HTMLElement | null;
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

function openRenderingDiagnostics() {
  const title = document.querySelector<HTMLButtonElement>("button.mobile-query-title");
  if (!title) return;
  if (title.getAttribute("aria-expanded") !== "true") title.click();
  window.setTimeout(() => {
    const queryMenu = document.querySelector<HTMLElement>(
      'nav.mobile-menu[aria-label="Query navigation"]',
    );
    const rendering = [...(queryMenu?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Rendering",
    );
    rendering?.click();
  }, 0);
}

function Diagnostics({ onClose }: { onClose: () => void }) {
  const snapshot = diagnosticSnapshot();

  const copy = async () => {
    await navigator.clipboard?.writeText(JSON.stringify(snapshot, null, 2));
  };

  const openRendering = () => {
    onClose();
    openRenderingDiagnostics();
  };

  return (
    <section className="enhancement-diagnostics" aria-label="Diagnostics">
      <header>
        <div>
          <span>DIAGNOSTICS</span>
          <strong>Startup and device</strong>
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
      <p>
        Open the rendering view for LOD, row-group, vertex-budget, GeoArrow, and cache metrics.
      </p>
      <div className="diagnostics-actions">
        <button onClick={openRendering}>Rendering diagnostics</button>
        <button className="diagnostics-copy" onClick={() => void copy()}>
          Copy diagnostics
        </button>
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

  useEffect(() => {
    const update = () =>
      setPanels((previous) => {
        const next = targets();
        const unchanged =
          previous.table === next.table &&
          previous.toolbar === next.toolbar &&
          previous.logoMenu === next.logoMenu &&
          previous.queryMenu === next.queryMenu;
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
      setDiagnosticsOpen(true);
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
          <button onClick={() => setDiagnosticsOpen(true)}>Diagnostics</button>,
          panels.logoMenu,
        )}
      {diagnosticsOpen &&
        createPortal(<Diagnostics onClose={() => setDiagnosticsOpen(false)} />, document.body)}
    </>
  );
}
