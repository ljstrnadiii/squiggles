import type { MapState } from "./contracts";

/** Keep only portable camera fields, including orientation from older saved links. */
export function normalizeCamera(camera: Pick<MapState, "longitude" | "latitude" | "zoom"> & Partial<MapState>, defaultPitch = 0): MapState {
  const pitch = Number.isFinite(camera.pitch) ? camera.pitch! : defaultPitch;
  const bearing = Number.isFinite(camera.bearing) ? camera.bearing! : 0;
  return {
    longitude: camera.longitude,
    latitude: camera.latitude,
    zoom: camera.zoom,
    pitch: Math.max(0, Math.min(85, pitch)),
    bearing: ((bearing + 180) % 360 + 360) % 360 - 180,
  };
}
