import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PanelEnhancements } from "./PanelEnhancements";
import "./styles.css";
import "./panelEnhancements.css";
import "./spatial.css";

createRoot(document.getElementById("root")!).render(<StrictMode><><App /><PanelEnhancements /></></StrictMode>);
