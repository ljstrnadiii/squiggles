import * as duckdb from "@duckdb/duckdb-wasm/dist/duckdb-browser.mjs";

export * from "@duckdb/duckdb-wasm/dist/duckdb-browser.mjs";

const isWorkerRuntime =
  typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope;
const progressChannel =
  isWorkerRuntime && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("squiggles-duckdb-progress")
    : null;

function emitProgress(message) {
  progressChannel?.postMessage({ type: "duckdb-progress", ...message });
}

export class AsyncDuckDB extends duckdb.AsyncDuckDB {
  constructor(...args) {
    super(...args);
    const handlers = this._onExecutionProgress;
    if (!Array.isArray(handlers)) return;
    handlers.push((progress) => {
      emitProgress({
        phase: "query",
        status: progress.status,
        percentage: Number(progress.percentage),
        repetitions: Number(progress.repetitions),
      });
    });
  }

  async instantiate(mainModuleURL, pthreadWorkerURL = null, progress = () => {}) {
    let bytesLoaded = 0;
    let bytesTotal = 0;
    await super.instantiate(mainModuleURL, pthreadWorkerURL, (entry) => {
      bytesLoaded = Number(entry.bytesLoaded);
      bytesTotal = Number(entry.bytesTotal);
      progress(entry);
      emitProgress({
        phase: "instantiate",
        status: "in-progress",
        ...(bytesTotal > 0 ? { percentage: (bytesLoaded / bytesTotal) * 100 } : {}),
        bytesLoaded,
        bytesTotal,
      });
    });
    emitProgress({
      phase: "instantiate",
      status: "completed",
      percentage: 100,
      bytesLoaded: bytesTotal || bytesLoaded,
      bytesTotal: bytesTotal || bytesLoaded,
    });
  }

  async connect() {
    const connection = await super.connect();
    await connection.query("SET enable_progress_bar = true");
    await connection.query("SET progress_bar_time = 250");
    return connection;
  }
}
