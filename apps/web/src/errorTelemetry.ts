import { renderingDiagnostics } from "./diagnosticState";

type ErrorSource = "window" | "promise" | "duckdb" | "duckdb-worker" | "application";

type ErrorContext = {
  source: ErrorSource;
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
let initialized = false;
let ready = false;

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
  const error = normalizeError(reason);
  emit("squiggles_error", {
    error,
    source: context.source,
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
  const clientUrl = config.clientUrl ?? "https://client.rum.us-east-1.amazonaws.com/1.0.2/cwr.js";
  window.AwsRumClient = { q: [], n: "cwr", i: config.appMonitorId, v: config.appVersion, r: config.region, c: {} };
  window.cwr = (command, payload) => window.AwsRumClient?.q.push({ c: command, p: payload });
  window.cwr("config", {
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
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = clientUrl;
  script.onload = () => { ready = true; flush(); };
  script.onerror = () => { ready = false; };
  document.head.appendChild(script);
}

export function initErrorTelemetry() {
  if (initialized) return;
  initialized = true;
  window.addEventListener("error", event => reportError(event.error ?? event.message, { source: "window", operation: "window.error" }));
  window.addEventListener("unhandledrejection", event => reportError(event.reason, { source: "promise", operation: "unhandledrejection" }));
  void fetch("/telemetry-config.json", { cache: "no-store" })
    .then(response => response.ok ? response.json() as Promise<TelemetryConfig> : null)
    .then(config => { if (config?.appMonitorId && config.identityPoolId && config.region) installRum(config); })
    .catch(() => undefined);
}

export const errorTelemetryTest = { sanitize, normalizeError };
