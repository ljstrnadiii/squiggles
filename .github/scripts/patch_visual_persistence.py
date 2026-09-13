from pathlib import Path


def replace(path: str, old: str, new: str):
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"missing patch marker in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


# Shared palette type + per-view visual encoding config.
replace(
    "apps/web/src/contracts.ts",
    'export type HeatPalette = "sunset" | "viridis" | "fire" | "ice";\n',
    'export type HeatPresetPalette = "sunset" | "viridis" | "fire" | "ice";\nexport type HeatPalette = HeatPresetPalette | `custom:${string}`;\n',
)
replace(
    "apps/web/src/contracts.ts",
    '  spatialFilter?: SpatialFilter;\n  startingPlans?: ResolutionRenderPlans;\n',
    '  spatialFilter?: SpatialFilter;\n  visualEncoding?: import("./visualEncoding").PersistedVisualEncodingSettings;\n  startingPlans?: ResolutionRenderPlans;\n',
)

# Runtime vs persisted visual encoding helpers.
replace(
    "apps/web/src/visualEncoding.ts",
    'export type VisualEncodingSettings = {\n  animateBy: string;\n  animationMode: AnimationMode;\n  animationStep: number;\n  windowSize: number;\n  playbackSpeed: number;\n  playing: boolean;\n  loop: boolean;\n  showMapControls: boolean;\n  colorBy: string;\n  palette: VisualPalette;\n};\n',
    'export type VisualEncodingSettings = {\n  animateBy: string;\n  animationMode: AnimationMode;\n  animationStep: number;\n  windowSize: number;\n  playbackSpeed: number;\n  playing: boolean;\n  loop: boolean;\n  showMapControls: boolean;\n  colorBy: string;\n  palette: VisualPalette;\n};\nexport type PersistedVisualEncodingSettings = Omit<VisualEncodingSettings, "animationStep" | "playing">;\n',
)
replace(
    "apps/web/src/visualEncoding.ts",
    'const HEX_COLOR = /^#[0-9a-f]{6}$/i;\n',
    '''const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const PRESET_PALETTES = new Set(["sunset", "viridis", "fire", "ice"]);
''',
)
replace(
    "apps/web/src/visualEncoding.ts",
    '''export function visualPaletteStops(palette: VisualPalette): string[] {
  if (!palette.startsWith("custom:")) return [];
  const stops = palette.slice("custom:".length).split(",").map(normalizedHexColor).filter((color): color is string => Boolean(color));
  return stops.length >= 2 ? stops : DEFAULT_CUSTOM_COLOR_STOPS;
}
''',
    '''function parsedCustomStops(palette: string): string[] {
  if (!palette.startsWith("custom:")) return [];
  return palette.slice("custom:".length).split(",").map(normalizedHexColor).filter((color): color is string => Boolean(color));
}

export function visualPaletteStops(palette: VisualPalette): string[] {
  if (!palette.startsWith("custom:")) return [];
  const stops = parsedCustomStops(palette);
  return stops.length >= 2 ? stops : DEFAULT_CUSTOM_COLOR_STOPS;
}

export function isVisualPalette(value: unknown): value is VisualPalette {
  return typeof value === "string" && (PRESET_PALETTES.has(value) || parsedCustomStops(value).length >= 2);
}

export function persistedVisualEncoding(settings: VisualEncodingSettings): PersistedVisualEncodingSettings {
  const { animationStep: _animationStep, playing: _playing, ...persisted } = settings;
  return persisted;
}

export function visualEncodingFromPersisted(settings?: Partial<PersistedVisualEncodingSettings>): VisualEncodingSettings {
  const playbackSpeed = Number(settings?.playbackSpeed);
  const windowSize = Number(settings?.windowSize);
  return {
    ...DEFAULT_VISUAL_ENCODING,
    animateBy: typeof settings?.animateBy === "string" ? settings.animateBy : "",
    animationMode: settings?.animationMode === "windowed" ? "windowed" : "cumulative",
    windowSize: Number.isFinite(windowSize) ? Math.max(1, Math.round(windowSize)) : DEFAULT_VISUAL_ENCODING.windowSize,
    playbackSpeed: Number.isFinite(playbackSpeed) ? Math.min(240, Math.max(0.1, playbackSpeed)) : DEFAULT_VISUAL_ENCODING.playbackSpeed,
    loop: typeof settings?.loop === "boolean" ? settings.loop : DEFAULT_VISUAL_ENCODING.loop,
    showMapControls: typeof settings?.showMapControls === "boolean" ? settings.showMapControls : DEFAULT_VISUAL_ENCODING.showMapControls,
    colorBy: typeof settings?.colorBy === "string" ? settings.colorBy : "",
    palette: isVisualPalette(settings?.palette) ? settings.palette : DEFAULT_VISUAL_ENCODING.palette,
    animationStep: 0,
    playing: false,
  };
}

export function normalizePersistedVisualEncoding(settings?: Partial<PersistedVisualEncodingSettings>): PersistedVisualEncodingSettings {
  return persistedVisualEncoding(visualEncodingFromPersisted(settings));
}
''',
)

# Custom Heat palettes use the same serialized ramp format as query coloring.
replace(
    "apps/web/src/heat.ts",
    'import type { BinaryRouteBatch, HeatPalette, MapState, RouteActivity } from "./contracts";\n',
    'import type { BinaryRouteBatch, HeatPalette, HeatPresetPalette, MapState, RouteActivity } from "./contracts";\n',
)
replace(
    "apps/web/src/heat.ts",
    'export const HEAT_COLOR_RANGES: Record<HeatPalette, Color[]> = {\n',
    'export const HEAT_COLOR_RANGES: Record<HeatPresetPalette, Color[]> = {\n',
)
replace(
    "apps/web/src/heat.ts",
    '''export function colorForWeight(weight: number, maximum: number, palette: HeatPalette, temperature = 1.7): Color {
  const colors = HEAT_COLOR_RANGES[palette];
''',
    '''function customHeatColors(palette: HeatPalette): Color[] | null {
  if (!palette.startsWith("custom:")) return null;
  const stops = palette.slice("custom:".length).split(",").filter(color => /^#[0-9a-f]{6}$/i.test(color));
  if (stops.length < 2) return null;
  return stops.map((color, index) => {
    const ratio = index / Math.max(1, stops.length - 1);
    return [
      Number.parseInt(color.slice(1, 3), 16),
      Number.parseInt(color.slice(3, 5), 16),
      Number.parseInt(color.slice(5, 7), 16),
      Math.round(210 + ratio * 45),
    ];
  });
}

export function colorForWeight(weight: number, maximum: number, palette: HeatPalette, temperature = 1.7): Color {
  const colors = customHeatColors(palette) ?? HEAT_COLOR_RANGES[palette as HeatPresetPalette];
''',
)

# Reusable color sequence editor.
Path("apps/web/src/CustomPaletteEditor.tsx").write_text('''import { customPalette, visualPaletteStops, type VisualPalette } from "./visualEncoding";

export function CustomPaletteEditor({ palette, onChange, label = "Color sequence" }: {
  palette: VisualPalette;
  onChange: (palette: VisualPalette) => void;
  label?: string;
}) {
  const stops = visualPaletteStops(palette);
  if (stops.length < 2) return null;

  function update(next: string[]) {
    onChange(customPalette(next));
  }

  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= stops.length) return;
    const next = [...stops];
    [next[index], next[destination]] = [next[destination], next[index]];
    update(next);
  }

  return <div className="custom-palette-editor">
    <span className="custom-palette-label">{label}</span>
    <div className="custom-color-stops">
      {stops.map((stop, index) => <div className="custom-color-stop" key={`${index}-${stop}`}>
        <input aria-label={`${label} color ${index + 1}`} type="color" value={stop} onChange={event => update(stops.map((colorStop, stopIndex) => stopIndex === index ? event.target.value : colorStop))} />
        <div className="custom-color-stop-actions">
          <button type="button" aria-label={`Move color ${index + 1} left`} disabled={index === 0} onClick={() => move(index, -1)}>←</button>
          <button type="button" aria-label={`Move color ${index + 1} right`} disabled={index === stops.length - 1} onClick={() => move(index, 1)}>→</button>
          <button type="button" aria-label={`Remove color ${index + 1}`} disabled={stops.length <= 2} onClick={() => update(stops.filter((_, stopIndex) => stopIndex !== index))}>×</button>
        </div>
      </div>)}
      <button className="add-color-stop" type="button" disabled={stops.length >= 12} onClick={() => update([...stops, "#ffffff"])}>+ color</button>
    </div>
    <small>Colors are interpolated evenly from first to last.</small>
  </div>;
}
''')

# Simplify query color editor to the shared component.
Path("apps/web/src/VisualEncodingControls.tsx").write_text('''import { useEffect, useState } from "react";
import type { HeatPalette, QueryDimension } from "./contracts";
import { CustomPaletteEditor } from "./CustomPaletteEditor";
import {
  colorForVisualDimension,
  customPalette,
  DEFAULT_CUSTOM_COLOR_STOPS,
  dimensionByName,
  visualPaletteStops,
  type VisualEncodingSettings,
} from "./visualEncoding";
import "./visualEncoding.css";

export function VisualEncodingControls({ dimensions, settings, onChange }: {
  dimensions: QueryDimension[];
  settings: VisualEncodingSettings;
  onChange: (settings: VisualEncodingSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fpsInput, setFpsInput] = useState(String(settings.playbackSpeed));
  const animation = dimensionByName(dimensions, settings.animateBy);
  const color = dimensionByName(dimensions, settings.colorBy);
  const steps = animation?.steps ?? [];
  const step = Math.max(0, Math.min(Math.max(0, steps.length - 1), settings.animationStep));
  const paletteMode = visualPaletteStops(settings.palette).length >= 2 ? "custom" : settings.palette;

  useEffect(() => {
    setFpsInput(String(settings.playbackSpeed));
  }, [settings.playbackSpeed]);

  function chooseAnimation(name: string) {
    const next = dimensionByName(dimensions, name);
    onChange({ ...settings, animateBy: name, animationStep: next ? Math.max(0, next.steps.length - 1) : 0, playing: false });
  }

  function choosePalette(value: string) {
    onChange({ ...settings, palette: value === "custom" ? customPalette(DEFAULT_CUSTOM_COLOR_STOPS) : value as HeatPalette });
  }

  function updatePlaybackSpeed(raw: string) {
    setFpsInput(raw);
    const fps = Number(raw);
    if (Number.isFinite(fps) && fps >= 0.1 && fps <= 240) onChange({ ...settings, playbackSpeed: fps });
  }

  function normalizePlaybackSpeed() {
    const parsed = Number(fpsInput);
    const fps = Number.isFinite(parsed) ? Math.min(240, Math.max(0.1, parsed)) : settings.playbackSpeed;
    setFpsInput(String(fps));
    if (fps !== settings.playbackSpeed) onChange({ ...settings, playbackSpeed: fps });
  }

  return <section className="toolbar-section visual-encoding">
    <button className="visual-encoding-toggle" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span><h3>Visual encoding</h3><small>Animate and color from query columns</small></span>
      <span aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    {open && <div className="visual-encoding-body">
      <div className="settings-grid">
        <label>Animate by<select aria-label="Animate by" value={settings.animateBy} onChange={event => chooseAnimation(event.target.value)}><option value="">Off</option>{dimensions.map(dimension => <option key={dimension.name} value={dimension.name}>{dimension.name}</option>)}</select></label>
        <label>Color by<select aria-label="Color by" value={settings.colorBy} onChange={event => onChange({ ...settings, colorBy: event.target.value })}><option value="">Off</option>{dimensions.map(dimension => <option key={dimension.name} value={dimension.name}>{dimension.name}</option>)}</select></label>
        {color && <label>Colors<select aria-label="Visual colormap" value={paletteMode} onChange={event => choosePalette(event.target.value)}><option value="sunset">Sunset</option><option value="viridis">Viridis</option><option value="fire">Fire</option><option value="ice">Ice</option><option value="custom">Custom</option></select></label>}
        {animation && <label>Mode<select aria-label="Animation mode" value={settings.animationMode} onChange={event => onChange({ ...settings, animationMode: event.target.value as VisualEncodingSettings["animationMode"] })}><option value="cumulative">Cumulative</option><option value="windowed">Windowed</option></select></label>}
        {animation && settings.animationMode === "windowed" && <label>Window<input aria-label="Animation window" type="number" min="1" max={Math.max(1, steps.length)} value={settings.windowSize} onChange={event => onChange({ ...settings, windowSize: Math.max(1, Number(event.target.value)) })} /></label>}
        {animation && <label>Speed (fps)<input aria-label="Animation speed" type="number" min="0.1" max="240" step="any" inputMode="decimal" value={fpsInput} onChange={event => updatePlaybackSpeed(event.target.value)} onBlur={normalizePlaybackSpeed} /></label>}
        {animation && <label className="check"><input aria-label="Show animation controls on map" type="checkbox" checked={settings.showMapControls} onChange={event => onChange({ ...settings, showMapControls: event.target.checked })} /> Map controls</label>}
      </div>
      {color && paletteMode === "custom" && <CustomPaletteEditor palette={settings.palette} onChange={palette => onChange({ ...settings, palette })} />}
      {animation && steps.length > 0 && <div className="animation-control">
        <button type="button" onClick={() => onChange({ ...settings, playing: !settings.playing })}>{settings.playing ? "Pause" : "Play"}</button>
        <input aria-label="Animation step" type="range" min="0" max={Math.max(0, steps.length - 1)} value={step} onChange={event => onChange({ ...settings, animationStep: Number(event.target.value), playing: false })} />
        <output>{String(steps[step] ?? "")}</output>
        <label className="check"><input type="checkbox" checked={settings.loop} onChange={event => onChange({ ...settings, loop: event.target.checked })} /> Loop</label>
      </div>}
      {color && <div className="dimension-legend" aria-label="Color legend">
        {color.kind === "numeric" && color.domain ? <span>{color.domain[0].toLocaleString()} → {color.domain[1].toLocaleString()}</span> : color.steps.slice(0, 12).map(value => {
          const sampleId = Object.keys(color.values).find(id => color.values[id] === value) ?? "";
          const rgba = colorForVisualDimension(color, sampleId, settings.palette);
          return <span key={String(value)}><i style={rgba ? { backgroundColor: `rgba(${rgba.join(",")})` } : undefined} />{String(value)}</span>;
        })}
        {color.steps.length > 12 && <span>+{color.steps.length - 12} more</span>}
      </div>}
      {!dimensions.length && <p>Return extra scalar columns with <code>activity_id</code> to animate or color by them.</p>}
      {settings.colorBy && <p>Color by overrides heat coloring while it is active.</p>}
    </div>}
  </section>;
}
''')

# Persist normalized visual config in each QueryTab.
replace(
    "apps/web/src/storage.ts",
    'import type { Basemap, QueryTab } from "./contracts";\n',
    'import type { Basemap, QueryTab } from "./contracts";\nimport { DEFAULT_VISUAL_ENCODING, normalizePersistedVisualEncoding, persistedVisualEncoding } from "./visualEncoding";\n',
)
replace(
    "apps/web/src/storage.ts",
    '  style: defaultStyle,\n};\n',
    '  style: defaultStyle,\n  visualEncoding: persistedVisualEncoding(DEFAULT_VISUAL_ENCODING),\n};\n',
)
replace(
    "apps/web/src/storage.ts",
    '    style: { ...style, color: normalizeRouteColor(style.color) },\n  };\n',
    '    style: { ...style, color: normalizeRouteColor(style.color) },\n    visualEncoding: normalizePersistedVisualEncoding(tab.visualEncoding),\n  };\n',
)

# Saved/unsaved indicator should include visual encoding configuration.
replace(
    "apps/web/src/MapNavigationEnhancements.tsx",
    'return JSON.stringify(tabs.map(tab => ({ id: tab.id, title: tab.title, sql: tab.sql, style: tab.style, spatialFilter: tab.spatialFilter })));',
    'return JSON.stringify(tabs.map(tab => ({ id: tab.id, title: tab.title, sql: tab.sql, style: tab.style, spatialFilter: tab.spatialFilter, visualEncoding: tab.visualEncoding })));',
)

# App integration: Heat custom UI + per-view persisted visual settings.
replace(
    "apps/web/src/App.tsx",
    'import { VisualEncodingControls } from "./VisualEncodingControls";\n',
    'import { VisualEncodingControls } from "./VisualEncodingControls";\nimport { CustomPaletteEditor } from "./CustomPaletteEditor";\n',
)
replace(
    "apps/web/src/App.tsx",
    'import { activityVisible, colorForVisualDimension, DEFAULT_VISUAL_ENCODING, dimensionByName, reconcileVisualEncoding, type VisualEncodingSettings } from "./visualEncoding";\n',
    'import { activityVisible, colorForVisualDimension, customPalette, DEFAULT_CUSTOM_COLOR_STOPS, dimensionByName, isVisualPalette, persistedVisualEncoding, reconcileVisualEncoding, visualEncodingFromPersisted, visualPaletteStops, type VisualEncodingSettings } from "./visualEncoding";\n',
)
replace(
    "apps/web/src/App.tsx",
    'const heatPalettes = new Set<HeatPalette>(["sunset", "viridis", "fire", "ice"]);\n',
    '',
)
replace(
    "apps/web/src/App.tsx",
    '...(palette && heatPalettes.has(palette as HeatPalette) ? { heatPalette: palette as HeatPalette } : {}),',
    '...(palette && isVisualPalette(palette) ? { heatPalette: palette } : {}),',
)
replace(
    "apps/web/src/App.tsx",
    'const [visualEncoding, setVisualEncoding] = useState<VisualEncodingSettings>(DEFAULT_VISUAL_ENCODING);',
    'const [visualEncoding, setVisualEncoding] = useState<VisualEncodingSettings>(() => visualEncodingFromPersisted(tab.visualEncoding));',
)
replace(
    "apps/web/src/App.tsx",
    'setRouteBatches([]); setHeat(emptyHeat); setQueryDimensions([]); setVisualEncoding(DEFAULT_VISUAL_ENCODING);',
    'setRouteBatches([]); setHeat(emptyHeat); setQueryDimensions([]); setVisualEncoding(visualEncodingFromPersisted(initialTab.visualEncoding));',
)
replace(
    "apps/web/src/App.tsx",
    'setActive(destination.id); setDraft(destination.sql); setView(destination.mapState); setRenderedView(destination.mapState); setTerrainCamera(null); setToolbarOpen(openQuery);',
    'setActive(destination.id); setDraft(destination.sql); setView(destination.mapState); setRenderedView(destination.mapState); setTerrainCamera(null); setVisualEncoding(visualEncodingFromPersisted(destination.visualEncoding)); setToolbarOpen(openQuery);',
)
replace(
    "apps/web/src/App.tsx",
    'const next = { ...defaultTab, mapState: { ...view }, style: { ...tab.style }, id: crypto.randomUUID(), title: "New Query" };',
    'const next = { ...defaultTab, mapState: { ...view }, style: { ...tab.style }, visualEncoding: persistedVisualEncoding(visualEncoding), id: crypto.randomUUID(), title: "New Query" };',
)
replace(
    "apps/web/src/App.tsx",
    'const next = { ...tab, style: { ...tab.style }, spatialFilter: tab.spatialFilter ? { ...tab.spatialFilter, polygon: [...tab.spatialFilter.polygon] } : undefined, id: crypto.randomUUID(), title: `${tab.title} copy`, sql: draft };',
    'const next = { ...tab, style: { ...tab.style }, visualEncoding: persistedVisualEncoding(visualEncoding), spatialFilter: tab.spatialFilter ? { ...tab.spatialFilter, polygon: [...tab.spatialFilter.polygon] } : undefined, id: crypto.randomUUID(), title: `${tab.title} copy`, sql: draft };',
)
replace(
    "apps/web/src/App.tsx",
    '  const pitchGesture = usePitchGesture(!terrainEnabled && !spatialDrawing, view, nextView => {\n',
    '''  function changeVisualEncoding(next: VisualEncodingSettings) {
    setVisualEncoding(next);
    const persisted = persistedVisualEncoding(next);
    const current = tabsRef.current.find(item => item.id === activeRef.current);
    if (!current || JSON.stringify(current.visualEncoding) === JSON.stringify(persisted)) return;
    const updated = tabsRef.current.map(item => item.id === activeRef.current ? { ...item, visualEncoding: persisted } : item);
    tabsRef.current = updated; setTabs(updated); saveTabs(updated, storageScopeRef.current);
  }
  const pitchGesture = usePitchGesture(!terrainEnabled && !spatialDrawing, view, nextView => {
''',
)
replace(
    "apps/web/src/App.tsx",
    '''        <label data-tooltip="Choose the color ramp for route proximity.">Colors<select aria-label="Heat colormap" value={tab.style.heatPalette} disabled={!tab.style.heatEnabled} onChange={event => changeStyle({ heatPalette: event.target.value as HeatPalette })}><option value="sunset">Sunset</option><option value="viridis">Viridis</option><option value="fire">Fire</option><option value="ice">Ice</option></select></label>
        <label className="temperature" data-tooltip="Higher values make less-frequent shared routes reach saturated colors sooner."><span>Temperature</span><input aria-label="Heat temperature" type="range" min="0.5" max="3" step="0.1" disabled={!tab.style.heatEnabled} value={tab.style.heatTemperature} onChange={event => changeStyle({ heatTemperature: Number(event.target.value) })} /><output>{tab.style.heatTemperature.toFixed(1)}×</output></label>
      </div></section>
      <VisualEncodingControls dimensions={queryDimensions} settings={visualEncoding} onChange={setVisualEncoding} />
''',
    '''        <label data-tooltip="Choose the color ramp for route proximity.">Colors<select aria-label="Heat colormap" value={visualPaletteStops(tab.style.heatPalette).length >= 2 ? "custom" : tab.style.heatPalette} disabled={!tab.style.heatEnabled} onChange={event => changeStyle({ heatPalette: event.target.value === "custom" ? customPalette(DEFAULT_CUSTOM_COLOR_STOPS) : event.target.value as HeatPalette })}><option value="sunset">Sunset</option><option value="viridis">Viridis</option><option value="fire">Fire</option><option value="ice">Ice</option><option value="custom">Custom</option></select></label>
        <label className="temperature" data-tooltip="Higher values make less-frequent shared routes reach saturated colors sooner."><span>Temperature</span><input aria-label="Heat temperature" type="range" min="0.5" max="3" step="0.1" disabled={!tab.style.heatEnabled} value={tab.style.heatTemperature} onChange={event => changeStyle({ heatTemperature: Number(event.target.value) })} /><output>{tab.style.heatTemperature.toFixed(1)}×</output></label>
      </div>{tab.style.heatEnabled && visualPaletteStops(tab.style.heatPalette).length >= 2 && <CustomPaletteEditor palette={tab.style.heatPalette} onChange={palette => changeStyle({ heatPalette: palette })} label="Heat color sequence" />}</section>
      <VisualEncodingControls dimensions={queryDimensions} settings={visualEncoding} onChange={changeVisualEncoding} />
''',
)
replace(
    "apps/web/src/App.tsx",
    '<AnimationMapControls dimension={animationDimension} settings={visualEncoding} onChange={setVisualEncoding} />',
    '<AnimationMapControls dimension={animationDimension} settings={visualEncoding} onChange={changeVisualEncoding} />',
)

# Unit coverage for custom Heat and config persistence.
Path("apps/web/src/heat.custom.test.ts").write_text('''import { describe, expect, it } from "vitest";
import { colorForWeight } from "./heat";
import { customPalette } from "./visualEncoding";

describe("custom heat palette", () => {
  it("uses custom endpoints across the heat domain", () => {
    const palette = customPalette(["#ff0000", "#0000ff"]);
    expect(colorForWeight(0, 10, palette).slice(0, 3)).toEqual([255, 0, 0]);
    expect(colorForWeight(10, 10, palette).slice(0, 3)).toEqual([0, 0, 255]);
  });
});
''')

visual_test = Path("apps/web/src/visualEncoding.test.ts")
text = visual_test.read_text()
text = text.replace(
    'import { activityVisible, colorForVisualDimension, customPalette, DEFAULT_VISUAL_ENCODING, reconcileVisualEncoding, visualPaletteStops } from "./visualEncoding";',
    'import { activityVisible, colorForVisualDimension, customPalette, DEFAULT_VISUAL_ENCODING, persistedVisualEncoding, reconcileVisualEncoding, visualEncodingFromPersisted, visualPaletteStops } from "./visualEncoding";',
)
needle = '  it("drops encodings that are absent from a new query", () => {'
test = '''  it("persists view animation configuration without live playback state", () => {
    const runtime = {
      ...DEFAULT_VISUAL_ENCODING,
      animateBy: "month",
      animationMode: "windowed" as const,
      animationStep: 2,
      windowSize: 3,
      playbackSpeed: 24,
      playing: true,
      loop: false,
      showMapControls: true,
      colorBy: "month",
      palette: customPalette(["#ff0000", "#0000ff"]),
    };
    const persisted = persistedVisualEncoding(runtime);
    expect(persisted).not.toHaveProperty("animationStep");
    expect(persisted).not.toHaveProperty("playing");
    expect(persisted).toMatchObject({ playbackSpeed: 24, showMapControls: true, animationMode: "windowed", windowSize: 3 });
    expect(visualEncodingFromPersisted(persisted)).toMatchObject({ playbackSpeed: 24, showMapControls: true, animationStep: 0, playing: false });
  });

'''
if needle not in text:
    raise SystemExit("visual encoding test marker missing")
visual_test.write_text(text.replace(needle, test + needle, 1))
