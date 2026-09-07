import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");
const app = readFileSync(join(import.meta.dirname, "App.tsx"), "utf8");
const html = readFileSync(join(webRoot, "index.html"), "utf8");

describe("interleaved map rendering", () => {
  it("renders visible deck layers in the Mapbox WebGL render loop", () => {
    expect(html).toContain("deck.gl@9.3.10/dist.min.js");
    expect(app).toContain("new window.deck.MapboxOverlay({ interleaved: true");
    expect(app).toContain("<BaseMap view={view} basemap={tab.style.basemap} theme={effectiveTheme} layers={layers} />");
  });

  it("keeps the React DeckGL surface for interaction without painting a second visible map", () => {
    expect(app).toContain("<DeckGL style={{ opacity: 0 }}");
    expect(app).toContain("pickable: false");
  });
});
