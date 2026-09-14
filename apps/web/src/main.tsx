import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./maplibreWorker";
import { App } from "./App";
import { MapNavigationEnhancements } from "./MapNavigationEnhancements";
import { PanelEnhancements } from "./PanelEnhancements";
import { initDuckDBProgressIndicator } from "./duckdbProgressIndicator";
import { initErrorTelemetry } from "./errorTelemetry";
import "./styles.css";
import "./designTokens.css";
import "./panelEnhancements.css";
import "./mapNavigationEnhancements.css";
import "./responsivePanels.css";
import "./spatial.css";

if (/^\/m\/[0-9a-f-]{36}\/?$/i.test(window.location.pathname)) {
  window.history.replaceState({}, "", "/");
}

document.documentElement.classList.add("map-navigation-redesign");
initErrorTelemetry();
initDuckDBProgressIndicator();
createRoot(document.getElementById("root")!).render(<StrictMode><><App /><PanelEnhancements /><MapNavigationEnhancements /></></StrictMode>);
