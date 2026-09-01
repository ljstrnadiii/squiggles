import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PanelEnhancements } from "./PanelEnhancements";
import "./styles.css";
import "./panelEnhancements.css";

const defaultPublishedPath = "/p/076a09fa";
if (window.location.hostname === "squiggles.io" && window.location.pathname === "/" && !window.location.search && !window.location.hash) {
  window.history.replaceState({}, "", defaultPublishedPath);
}

createRoot(document.getElementById("root")!).render(<StrictMode><><App /><PanelEnhancements /></></StrictMode>);
