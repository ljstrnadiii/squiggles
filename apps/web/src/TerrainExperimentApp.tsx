import {useEffect, useMemo, useState} from "react";

import type {DatasetSource, MapState, ViewportResult} from "./contracts";
import {routeColors} from "./binaryRoutes";
import {BrowserDuckDBEngine} from "./engine";
import {MapLibreTerrainRoutes} from "./MapLibreTerrainRoutes";
import {defaultTab} from "./storage";

function fitBounds([xmin, ymin, xmax, ymax]: [number, number, number, number]): MapState {
  const span = Math.max(xmax - xmin, (ymax - ymin) * 1.6, 0.001);
  return {longitude: (xmin + xmax) / 2, latitude: (ymin + ymax) / 2, zoom: Math.max(1, Math.min(13, Math.log2(360 / span) - 0.8))};
}

export function TerrainExperimentApp() {
  const engine = useMemo(() => new BrowserDuckDBEngine(), []);
  const [view, setView] = useState<MapState>(defaultTab.mapState);
  const [result, setResult] = useState<ViewportResult | null>(null);
  const [status, setStatus] = useState("Opening Squiggles terrain experiment…");
  const [interacting, setInteracting] = useState(false);

  useEffect(() => {
    engine.setResolution("medium");
    const parameters = new URLSearchParams(window.location.search);
    const local = parameters.get("dataset");
    const sourceUrl = parameters.get("datasetUrl");
    if (!local && !sourceUrl) {
      setStatus("Add ?terrain=1&dataset=<local dataset id> or &datasetUrl=<dataset root URL>");
      return;
    }
    const source: DatasetSource = sourceUrl
      ? {kind: "url", baseUrl: sourceUrl.replace(/\/$/, ""), name: sourceUrl}
      : {kind: "url", baseUrl: `/local-data/${local!}`, name: local!};
    let cancelled = false;
    void (async () => {
      try {
        setStatus("Reading dataset manifest…");
        const dataset = await engine.openDataset(source, (done, total) => !cancelled && setStatus(`Opening dataset · ${done.toLocaleString()} / ${total.toLocaleString()} files`));
        if (cancelled) return;
        const initial = fitBounds(dataset.manifest.bbox);
        setView(initial);
        setStatus("Running DuckDB selection + LOD…");
        const rendered = await engine.execute({...defaultTab, mapState: initial}, initial.zoom);
        if (cancelled) return;
        setResult(rendered);
        setStatus(`${rendered.activityCount.toLocaleString()} routes · ${rendered.vertexCount.toLocaleString()} vertices · LOD ${rendered.lod}`);
      } catch (reason) {
        if (!cancelled) setStatus(`Terrain experiment failed: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    })();
    return () => {cancelled = true;};
  }, [engine]);

  const colors = useMemo(() => result?.batches.map(batch => routeColors(batch, () => [35, 105, 255, 220])) ?? [], [result]);
  return <main style={{position: "fixed", inset: 0, background: "#07100e"}}>
    {result && <MapLibreTerrainRoutes view={view} basemap="carto-dark" dark batches={result.batches} colors={colors} widthPx={2.5} onView={setView} onInteraction={setInteracting}/>} 
    <div style={{position: "absolute", zIndex: 20, left: 12, top: 12, maxWidth: 520, padding: "9px 12px", borderRadius: 8, background: "rgba(7,16,14,.88)", color: "white", font: "13px/1.35 system-ui,sans-serif"}}>
      <strong style={{display: "block"}}>Squiggles × MapLibre fork · real binary terrain</strong>
      <span>{status}{interacting ? " · moving" : ""}</span>
      <small style={{display: "block", marginTop: 4, opacity: .76}}>Actual BrowserDuckDBEngine + BinaryRouteBatch data. MapLibre owns the pitched 3D camera; routes render through the fork's terrain RTT hook.</small>
    </div>
  </main>;
}
