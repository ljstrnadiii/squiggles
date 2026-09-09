import type { Map, Source } from "maplibre-gl";

/** Preserve MapLibre's horizon decay and add a bounded, per-source zoom bias. */
export function applyTileDetail(map: Map, sourceId: string, detail: number) {
  if (!map.getSource(sourceId)) return;
  // Reset the base function each time so repeated updates never accumulate bias.
  map.setSourceTileLodParams(9.314, 3, sourceId);
  const source = map.getSource(sourceId) as Source;
  const base = source.calculateTileZoom!;
  source.calculateTileZoom = (...args) => base(...args) + (map.isMoving() ? Math.min(detail, 1) : detail);
  map.triggerRepaint();
}
