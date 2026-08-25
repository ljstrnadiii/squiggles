import type { SystemResolution } from "./contracts";

const KEY = "activity-map.resolution.v1";

export function defaultSystemResolution(coarsePointer = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches): SystemResolution {
  return coarsePointer ? "low" : "medium";
}

export function loadSystemResolution(): SystemResolution {
  const stored = localStorage.getItem(KEY);
  return stored === "low" || stored === "medium" || stored === "high" ? stored : defaultSystemResolution();
}

export function saveSystemResolution(resolution: SystemResolution) {
  localStorage.setItem(KEY, resolution);
}
