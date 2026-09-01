import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type PanelTargets = { stats: HTMLElement | null; table: HTMLElement | null };

function targets(): PanelTargets {
  return {
    stats: document.querySelector<HTMLElement>('section.rich-stats[aria-label="Detailed selection statistics"]'),
    table: document.querySelector<HTMLElement>('section.activity-table[aria-label="Activity table"]'),
  };
}

export function PanelEnhancements() {
  const [panels, setPanels] = useState<PanelTargets>(() => targets());
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);

  useEffect(() => {
    const update = () => setPanels(previous => {
      const next = targets();
      return previous.stats === next.stats && previous.table === next.table ? previous : next;
    });
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => { if (!panels.stats) setStatsExpanded(false); }, [panels.stats]);
  useEffect(() => { if (!panels.table) setTableExpanded(false); }, [panels.table]);

  useEffect(() => {
    panels.stats?.toggleAttribute("data-panel-expanded", statsExpanded);
    return () => panels.stats?.removeAttribute("data-panel-expanded");
  }, [panels.stats, statsExpanded]);
  useEffect(() => {
    panels.table?.toggleAttribute("data-panel-expanded", tableExpanded);
    return () => panels.table?.removeAttribute("data-panel-expanded");
  }, [panels.table, tableExpanded]);

  const statsHeader = panels.stats?.querySelector("header");
  const tableHeader = panels.table?.querySelector("header");

  return <>
    {statsHeader && createPortal(<button className="panel-expand" aria-label={statsExpanded ? "Use compact statistics panel" : "Expand statistics panel"} title={statsExpanded ? "Compact" : "Expand"} onClick={() => setStatsExpanded(value => !value)}>{statsExpanded ? "↙" : "↗"}</button>, statsHeader)}
    {tableHeader && createPortal(<button className="panel-expand" aria-label={tableExpanded ? "Use compact activity table" : "Expand activity table"} title={tableExpanded ? "Compact" : "Expand"} onClick={() => setTableExpanded(value => !value)}>{tableExpanded ? "↙" : "↗"}</button>, tableHeader)}
  </>;
}
