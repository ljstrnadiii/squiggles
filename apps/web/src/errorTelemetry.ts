import { renderingDiagnostics } from "./diagnosticState";
import { BrowserDuckDBEngine } from "./engine";

type ErrorSource = "window" | "promise" | "duckdb" | "duckdb-worker" | "application";
type ErrorKind = "unexpected" | "query";

type ErrorContext = {
  source: ErrorSource;
  kind?: ErrorKind;
  operation?: string;
  requestType?: string;
  schemaVersion?: string;
  compilerVersion?: string;
};

type TelemetryConfig = {
  appMonitorId: string;
  region: string;
  identityPoolId: string;
  appVersion: string;
  gitSha: string;
  clientUrl?: string;
};

type RumCommand = (command: string, payload?: unknown) => void;

declare global {
  interface Window {
    cwr?: RumCommand;
    AwsRumClient?: { q: Array<{ c: string; p: unknown }>; n: string; i: string; v: string; r: string; c: unknown };
  }
}

const MAX_MESSAGE = 500;
const MAX_STACK = 1800;
const MAX_QUEUE = 20;
const SECRET_PATTERN = /(authorization|bearer|token|secret|password|credential|access[_-]?key)[=: ]+[^\s,;]+/gi;
const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const LOCAL_PATH_PATTERN = /(?:file:\/\/)?\/?(?:Users|home)\/[^\s)]+/gi;
const queue: Array<{ type: string; data: Record<string, unknown> }> = [];
const reportedObjects = new WeakSet<object>();
let initialized = false;
let ready = false;
let duckdbInstrumented = false;

function sanitize(value: string, limit: number) {
  return value
    .replace(SECRET_PATTERN, "$1=[redacted]")
    .replace(URL_PATTERN, "[url]")
    .replace(LOCAL_PATH_PATTERN, "[local-path]")
    .slice(0, limit);
}

function normalizeError(reason: unknown) {
  if (reason instanceof Error) {
    return {
      name: sanitize(reason.name || "Error", 80),
      message: sanitize(reason.message, MAX_MESSAGE),
      stack: reason.stack ? sanitize(reason.stack, MAX_STACK) : undefined,
    };
  }
  return { name: "Error", message: sanitize(String(reason), MAX_MESSAGE), stack: undefined };
}

function diagnosticContext() {
  const diagnostics = renderingDiagnostics();
  if (!diagnostics) return undefined;
  return {
    lod: diagnostics.lod,
    vertexCount: diagnostics.vertexCount,
    vertexBudget: diagnostics.vertexBudget,
    visibleCount: diagnostics.visibleCount,
    durationMs: Math.round(diagnostics.durationMs),
    cacheHit: diagnostics.cache.hit,
    mapView: diagnostics.mapView,
    basemap: diagnostics.basemap,
    terrainSegments: diagnostics.terrain.submittedSegments,
    terrainTiles: diagnostics.terrain.tileCount,
  };
}

function emit(type: string, data: Record<string, unknown>) {
  if (ready && window.cwr) {
    try { window.cwr("recordEvent", { type, data }); } catch { /* telemetry must never affect the app */ }
    return;
  }
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ type, data });
}

export function reportError(reason: unknown, context: ErrorContext) {
  if (typeof reason === "object" && reason !== null) {
    if (reportedObjects.has(reason)) return;
    reportedObjects.add(reason);
  }
  const error = normalizeError(reason);
  emit("squiggles_error", {
    error,
    source: context.source,
    kind: context.kind ?? "unexpected",
    operation: context.operation,
    requestType: context.requestType,
    schemaVersion: context.schemaVersion,
    compilerVersion: context.compilerVersion,
    diagnostics: diagnosticContext(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: Number(window.devicePixelRatio.toFixed(2)),
    timestamp: new Date().toISOString(),
  });
}

function flush() {
  if (!ready || !window.cwr) return;
  while (queue.length) {
    const event = queue.shift()!;
    try { window.cwr("recordEvent", event); } catch { return; }
  }
}

function installRum(config: TelemetryConfig) {
  const clientUrl = config.clientUrl ?? "https://client.rum.us-east-1.amazonaws.com/3.2.1/cwr.js";
  const rumConfig = {
    sessionSampleRate: 1,
    identityPoolId: config.identityPoolId,
    endpoint: `https://dataplane.rum.${config.region}.amazonaws.com`,
    telemetries: ["errors"],
    allowCookies: false,
    enableXRay: false,
    sessionAttributes: {
      applicationVersion: config.appVersion,
      gitSha: config.gitSha,
    },
  };
  window.AwsRumClient = { q: [], n: "cwr", i: config.appMonitorId, v: config.appVersion, r: config.region, c: rumConfig };
  window.cwr = (command, payload) => window.AwsRumClient?.q.push({ c: command, p: payload });
  const script = document.createElement("script");
  script.async = true;
  script.src = clientUrl;
  script.onload = () => { ready = true; flush(); };
  script.onerror = () => { ready = false; };
  document.head.appendChild(script);
}

function duckdbErrorKind(operation: string, reason: unknown): ErrorKind {
  if (operation !== "execute") return "unexpected";
  const message = reason instanceof Error ? reason.message : String(reason);
  return /(Parser Error|Binder Error|Catalog Error|syntax error)/i.test(message) ? "query" : "unexpected";
}

function instrumentDuckDB() {
  if (duckdbInstrumented) return;
  duckdbInstrumented = true;
  const methods = ["openDataset", "execute", "renderViewport", "getSummary", "getActivities", "getRouteMetadata", "getActivity"] as const;
  const prototype = BrowserDuckDBEngine.prototype as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const operation of methods) {
    const original = prototype[operation];
    if (!original) continue;
    prototype[operation] = function(this: BrowserDuckDBEngine, ...args: unknown[]) {
      try {
        return Promise.resolve(original.apply(this, args)).catch(reason => {
          reportError(reason, { source: "duckdb", operation, requestType: operation, kind: duckdbErrorKind(operation, reason) });
          throw reason;
        });
      } catch (reason) {
        reportError(reason, { source: "duckdb", operation, requestType: operation, kind: duckdbErrorKind(operation, reason) });
        throw reason;
      }
    };
  }
}

export function initErrorTelemetry() {
  if (initialized) return;
  initialized = true;
  instrumentDuckDB();
  window.addEventListener("error", event => reportError(event.error ?? event.message, { source: "window", operation: "window.error" }));
  window.addEventListener("unhandledrejection", event => reportError(event.reason, { source: "promise", operation: "unhandledrejection" }));
  void fetch("/telemetry-config.json", { cache: "no-store" })
    .then(response => response.ok ? response.json() as Promise<TelemetryConfig> : null)
    .then(config => { if (config?.appMonitorId && config.identityPoolId && config.region) installRum(config); })
    .catch(() => undefined);
}

export const errorTelemetryTest = { sanitize, normalizeError, duckdbErrorKind };
