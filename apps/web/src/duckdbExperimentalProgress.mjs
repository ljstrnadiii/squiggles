import * as duckdb from "@duckdb/duckdb-wasm/dist/duckdb-browser.mjs";

export * from "@duckdb/duckdb-wasm/dist/duckdb-browser.mjs";

const isWorkerRuntime =
  typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope;
const progressChannel =
  isWorkerRuntime && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("squiggles-duckdb-progress")
    : null;
let nextQueryId = 0;

function emitProgress(message) {
  progressChannel?.postMessage({ type: "duckdb-progress", ...message });
}

export class AsyncDuckDB extends duckdb.AsyncDuckDB {
  constructor(...args) {
    super(...args);
    this._squigglesProgressEnabled = false;
    this._squigglesActiveQueries = [];
    const handlers = this._onExecutionProgress;
    if (!Array.isArray(handlers)) return;
    handlers.push((progress) => {
      if (!this._squigglesProgressEnabled) return;
      const queryId = this._squigglesActiveQueries.at(-1);
      if (queryId == null) return;
      emitProgress({
        phase: "query",
        status: "progress",
        queryId,
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

  async runQuery(connectionId, text) {
    if (!this._squigglesProgressEnabled) {
      return super.runQuery(connectionId, text);
    }
    const queryId = ++nextQueryId;
    this._squigglesActiveQueries.push(queryId);
    emitProgress({ phase: "query", status: "started", queryId });
    try {
      return await super.runQuery(connectionId, text);
    } finally {
      const index = this._squigglesActiveQueries.lastIndexOf(queryId);
      if (index >= 0) this._squigglesActiveQueries.splice(index, 1);
      emitProgress({ phase: "query", status: "completed", queryId });
    }
  }

  async connect() {
    const connection = await super.connect();
    await connection.query("SET enable_progress_bar = true");
    await connection.query("SET progress_bar_time = 50");
    this._squigglesProgressEnabled = true;
    return connection;
  }
}
