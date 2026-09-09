import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./maplibreWorker";
import { App } from "./App";
import { PanelEnhancements } from "./PanelEnhancements";
import "./styles.css";
import "./panelEnhancements.css";
import "./spatial.css";
import "./mapDisclosure.css";

createRoot(document.getElementById("root")!).render(<StrictMode><><App /><PanelEnhancements /></></StrictMode>);
