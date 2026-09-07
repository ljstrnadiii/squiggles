# Mapbox basemaps and 3D view

Squiggles uses one persistent Mapbox GL JS map underneath deck.gl. SQL changes, camera movement, and basemap changes must not recreate that map instance.

## Basemaps

The map menu intentionally stays small:

- Mapbox Standard
- Mapbox Standard Satellite
- Mapbox Outdoors / Topographic
- CARTO Light
- CARTO Dark
- Blank / offline

Legacy saved values migrate automatically:

- `streets` → `mapbox-standard`
- `topo` → `mapbox-outdoors`
- `imagery` → `mapbox-satellite`

When `VITE_MAPBOX_ACCESS_TOKEN` is not configured, Mapbox selections fall back to the current-theme CARTO map so local development remains usable.

## Camera and 3D interaction

2D/3D is separate from the basemap choice.

The persisted camera is:

- longitude
- latitude
- zoom
- bearing
- pitch

In 3D mode deck.gl owns camera interaction and Mapbox follows the exact same camera before paint. Mouse/touch rotation is enabled, including multi-touch rotation and pitch gestures. Switching to 2D resets pitch and bearing to zero; entering 3D from a flat view starts at a useful pitch and then leaves the camera fully user-controlled.

Camera orientation is persisted in saved query tabs, copied URLs, and published views. Older local and published maps without `bearing`/`pitch` migrate to north-up 2D.

Viewport pruning also uses the pitched/rotated camera footprint so route fetching remains aligned with what the basemap displays.

## Token and billing guardrails

The browser reads a URL-restricted public token from `VITE_MAPBOX_ACCESS_TOKEN`. Production injects that value from the GitHub `production` environment during the Vite build.

The implementation uses Mapbox GL JS map loads rather than the Static Images / Static Tiles APIs and keeps one map instance alive across style and camera changes. This limits map-load accounting to map initialization rather than every interaction or SQL run.

## Deferred

### Terrain

Perspective 3D does not currently enable DEM terrain. Squiggles route coordinates do not yet carry a terrain-draping integration, so naïvely enabling Mapbox terrain could visually separate routes from the ground surface.

A terrain follow-up should add correct route draping before enabling DEM-backed terrain.

### Globe

Mapbox globe uses a non-Mercator projection. deck.gl's Mapbox overlay integration does not support Mapbox non-Mercator projections, so globe is deferred rather than shipping a basemap/route alignment bug.
