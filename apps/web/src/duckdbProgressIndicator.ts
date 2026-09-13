type DuckDBProgressMessage = {
  type?: string;
  phase?: "instantiate" | "query";
  status?: string;
  queryId?: number;
  percentage?: number;
  bytesLoaded?: number;
  bytesTotal?: number;
};

const QUERY_SHOW_DELAY_MS = 75;
const HIDE_DELAY_MS = 100;

function clearDeterminate(status: HTMLElement) {
  status.classList.remove("duckdb-determinate");
  status.style.removeProperty("--duckdb-progress");
  status.removeAttribute("data-duckdb-progress");
  status.removeAttribute("data-duckdb-progress-phase");
}

function setDeterminate(status: HTMLElement, message: DuckDBProgressMessage) {
  const percentage = Number(message.percentage);
  if (!Number.isFinite(percentage) || percentage <= 0) {
    clearDeterminate(status);
    return;
  }
  const clamped = Math.max(0, Math.min(100, percentage));
  status.classList.add("duckdb-determinate");
  status.style.setProperty("--duckdb-progress", `${clamped}%`);
  status.dataset.duckdbProgress = clamped.toFixed(0);
  status.dataset.duckdbProgressPhase = message.phase ?? "query";
}

export function initDuckDBProgressIndicator() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("squiggles-duckdb-progress");
  const activeQueries = new Set<number>();
  let instantiating = false;
  let showTimer: number | null = null;
  let hideTimer: number | null = null;

  const statusElement = () => document.querySelector<HTMLElement>("header.topbar .status");
  const cancelShow = () => {
    if (showTimer != null) window.clearTimeout(showTimer);
    showTimer = null;
  };
  const cancelHide = () => {
    if (hideTimer != null) window.clearTimeout(hideTimer);
    hideTimer = null;
  };
  const show = () => {
    cancelShow();
    cancelHide();
    statusElement()?.classList.add("duckdb-active");
  };
  const hide = () => {
    if (instantiating || activeQueries.size > 0) return;
    const status = statusElement();
    if (!status) return;
    clearDeterminate(status);
    status.classList.remove("duckdb-active");
  };
  const scheduleShow = () => {
    cancelHide();
    if (showTimer != null) return;
    showTimer = window.setTimeout(show, QUERY_SHOW_DELAY_MS);
  };
  const scheduleHide = () => {
    cancelShow();
    cancelHide();
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      hide();
    }, HIDE_DELAY_MS);
  };

  channel.addEventListener("message", (event: MessageEvent<DuckDBProgressMessage>) => {
    const message = event.data;
    if (message?.type !== "duckdb-progress") return;
    const status = statusElement();

    if (message.phase === "instantiate") {
      if (message.status === "completed") {
        instantiating = false;
        scheduleHide();
        return;
      }
      instantiating = true;
      show();
      if (status) setDeterminate(status, message);
      return;
    }

    if (message.phase !== "query" || message.queryId == null) return;
    if (message.status === "started") {
      activeQueries.add(message.queryId);
      if (status) clearDeterminate(status);
      scheduleShow();
      return;
    }
    if (message.status === "completed") {
      activeQueries.delete(message.queryId);
      if (activeQueries.size === 0) scheduleHide();
      return;
    }

    activeQueries.add(message.queryId);
    show();
    if (status) setDeterminate(status, message);
  });
}
