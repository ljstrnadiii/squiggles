import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./maplibreWorker";
import { App } from "./App";
import { PanelEnhancements } from "./PanelEnhancements";
import { initErrorTelemetry } from "./errorTelemetry";
import "./styles.css";
import "./panelEnhancements.css";
import "./spatial.css";
import "./mapDisclosure.css";

initErrorTelemetry();
createRoot(document.getElementById("root")!).render(<StrictMode><><App /><PanelEnhancements /></></StrictMode>);
