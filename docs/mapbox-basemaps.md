# Mapbox tiles with MapLibre

Squiggles uses MapLibre GL JS for the 3D map and a non-interactive MapLibre raster map beneath deck.gl in 2D. Providing Mapbox tiles does not change the rendering engine.

The 3D view uses Mapterhorn's public TileJSON source. It provides 512-pixel, Terrarium-encoded WebP terrain tiles built for MapLibre, including global coverage and higher-resolution regional data.

When `VITE_MAPBOX_ACCESS_TOKEN` is set, the Imagery basemap uses Mapbox Satellite `@2x` JPEG tiles. When the token is absent, Imagery falls back to Esri World Imagery. The other basemap choices are unchanged.

The browser token must be public and URL restricted. Production injects `VITE_MAPBOX_ACCESS_TOKEN` from the GitHub `production` environment during the Vite build. Local browser testing also requires the localhost origin to be allowed by that token.

The persisted camera contains longitude, latitude, zoom, pitch, and bearing. Camera movement updates the active query tab, copied URL, and published view. A query result may replace route data after the camera moves, but it must not restore the camera captured when the query began.
