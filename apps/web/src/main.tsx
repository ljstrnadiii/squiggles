import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PanelEnhancements } from "./PanelEnhancements";
import { TerrainExperimentApp } from "./TerrainExperimentApp";
import "./styles.css";
import "./panelEnhancements.css";
import "./spatial.css";
import "./mapDisclosure.css";

const terrainExperiment = new URLSearchParams(window.location.search).get("terrain") === "1";
const root = createRoot(document.getElementById("root")!);

if (terrainExperiment) {
  // Keep the real-data terrain harness single-mounted in development. React
  // StrictMode intentionally re-runs effects, which can otherwise issue two
  // concurrent DuckDB open requests against the same worker during startup.
  root.render(<TerrainExperimentApp />);
} else {
  root.render(<StrictMode><><App /><PanelEnhancements /></></StrictMode>);
}
