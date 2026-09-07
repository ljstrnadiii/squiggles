# Mapbox basemaps and 3D view

## Goal

Add Mapbox-hosted basemaps to Squiggles without changing the SQL/rendering model or creating surprise usage from map interaction.

## Recommended basemaps

Keep the menu intentionally small:

- **Standard** — default general-purpose Mapbox vector basemap.
- **Standard Satellite** — high-resolution satellite/aerial imagery with Mapbox labels and 3D features.
- **Outdoors / Topographic** — terrain-first map emphasizing contours, trails, parks, ski runs, and land cover. Mapbox currently exposes this as the classic `outdoors-v12` style; it is useful for Squiggles even though Mapbox recommends Standard for new applications.
- **CARTO Light** — existing low-contrast route-first option.
- **CARTO Dark** — existing dark route-first option.
- **Blank / offline** — existing no-network fallback.

The existing OSM Streets, OpenTopoMap, and Esri imagery entries can be removed once their Mapbox equivalents are validated.

## Mapbox token

Use a dedicated public token supplied through `VITE_MAPBOX_ACCESS_TOKEN`.

Production tokens should be URL-restricted to the Squiggles production domain. Development should use a separate token restricted to localhost/preview hosts.

Do not commit a token to the repository.

## Billing guardrail

Use **Mapbox GL JS with Mapbox styles**, rather than calling Mapbox raster/static tile APIs from MapLibre. The GL JS pricing model is based on map loads; pan/zoom/style interaction inside one live map instance does not create a new map load.

Keep a single map instance alive for the lifetime of the map view. SQL runs, route updates, style changes, and camera movement must update that instance rather than recreate it.

## View modes

Treat the camera separately from the basemap choice:

- **2D** — north-up, pitch 0.
- **3D** — pitched perspective with Mapbox 3D environment enabled.

Do not add a separate “3D basemap” entry.

### Terrain caveat

Squiggles routes currently render in deck.gl as longitude/latitude geometry without per-vertex Z values. Mapbox terrain can therefore visually diverge from the route overlay if terrain is enabled naively.

True terrain mode should only ship after routes are draped onto the terrain surface (for example via a deck.gl terrain source/extension or another shared-terrain integration). Until then, the 3D mode should be limited to perspective/Mapbox 3D features that preserve correct route alignment.

## Globe

Do **not** ship a Mapbox globe toggle in the first implementation. deck.gl's Mapbox overlay integration does not support Mapbox non-Mercator projections, so a Mapbox globe can cause the basemap and Squiggles route geometry to use different projections.

If globe becomes important, evaluate either:

1. MapLibre globe + deck.gl integration, which deck.gl explicitly supports; or
2. deck.gl `GlobeView`, accepting its experimental/high-zoom limitations.

Globe should remain a separate follow-up from Mapbox basemap adoption.

## Implementation sequence

1. Add `mapbox-gl` and switch the basemap renderer from MapLibre to Mapbox GL JS while preserving the single-instance lifecycle.
2. Add `VITE_MAPBOX_ACCESS_TOKEN` configuration with a graceful fallback when unset.
3. Replace the current basemap menu with Standard, Standard Satellite, Outdoors/Topo, CARTO Light, CARTO Dark, and Blank.
4. Add a compact **2D / 3D** view-mode control beside the basemap selector.
5. Preserve camera and map-instance identity across SQL runs and basemap changes.
6. Add tests that verify style changes do not recreate the map instance.
7. Follow up separately on terrain draping and globe support.
