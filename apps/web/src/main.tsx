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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {terrainExperiment ? <TerrainExperimentApp /> : <><App /><PanelEnhancements /></>}
  </StrictMode>,
);
