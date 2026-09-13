type DuckDBProgressMessage = {
  type?: string;
  phase?: "instantiate" | "query";
  status?: string;
  percentage?: number;
  bytesLoaded?: number;
  bytesTotal?: number;
};

function clearDeterminate(status: HTMLElement) {
  status.classList.remove("duckdb-determinate");
  status.style.removeProperty("--duckdb-progress");
  status.removeAttribute("data-duckdb-progress");
  status.removeAttribute("data-duckdb-progress-phase");
}

export function initDuckDBProgressIndicator() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("squiggles-duckdb-progress");
  channel.addEventListener("message", (event: MessageEvent<DuckDBProgressMessage>) => {
    const message = event.data;
    if (message?.type !== "duckdb-progress") return;
    const status = document.querySelector<HTMLElement>("header.topbar .status");
    if (!status) return;

    const percentage = Number(message.percentage);
    if (
      message.status === "completed" ||
      !Number.isFinite(percentage) ||
      percentage <= 0 ||
      percentage >= 100
    ) {
      clearDeterminate(status);
      return;
    }

    const clamped = Math.max(0, Math.min(100, percentage));
    status.classList.add("duckdb-determinate");
    status.style.setProperty("--duckdb-progress", `${clamped}%`);
    status.dataset.duckdbProgress = clamped.toFixed(0);
    status.dataset.duckdbProgressPhase = message.phase ?? "query";
  });
}
