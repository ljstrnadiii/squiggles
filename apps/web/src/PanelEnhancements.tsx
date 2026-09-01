import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type PanelTargets = { table: HTMLElement | null; toolbar: HTMLElement | null };

function targets(): PanelTargets {
  return {
    table: document.querySelector<HTMLElement>('section.activity-table[aria-label="Activity table"]'),
    toolbar: document.querySelector<HTMLElement>('section.toolbar[aria-label="Query and map settings"]'),
  };
}

export function PanelEnhancements() {
  const [panels, setPanels] = useState<PanelTargets>(() => targets());
  const [tableExpanded, setTableExpanded] = useState(false);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);

  useEffect(() => {
    const update = () => setPanels(previous => {
      const next = targets();
      return previous.table === next.table && previous.toolbar === next.toolbar ? previous : next;
    });
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => { if (!panels.table) setTableExpanded(false); }, [panels.table]);
  useEffect(() => { if (!panels.toolbar) setToolbarExpanded(false); }, [panels.toolbar]);

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

  return <>
    {tableHeader && createPortal(<button className="panel-expand" aria-label={tableExpanded ? "Exit full screen activity table" : "Open activity table full screen"} title={tableExpanded ? "Exit full screen" : "Full screen"} onClick={() => setTableExpanded(value => !value)}>{tableExpanded ? "⊙" : "⛶"}</button>, tableHeader)}
    {toolbarHeader && createPortal(<button className="panel-expand" aria-label={toolbarExpanded ? "Exit full screen query settings" : "Open query settings full screen"} title={toolbarExpanded ? "Exit full screen" : "Full screen"} onClick={() => setToolbarExpanded(value => !value)}>{toolbarExpanded ? "⊙" : "⛶"}</button>, toolbarHeader)}
  </>;
}
