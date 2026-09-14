import { useEffect, useState } from "react";
import type { HeatPalette, QueryDimension } from "./contracts";
import { CustomPaletteEditor } from "./CustomPaletteEditor";
import {
  animationFrameLabel,
  animationStepIndex,
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
  const step = animation ? animationStepIndex(animation, settings.animationStep) : 0;
  const paletteMode = visualPaletteStops(settings.palette).length >= 2 ? "custom" : settings.palette;

  useEffect(() => {
    setFpsInput(String(settings.playbackSpeed));
  }, [settings.playbackSpeed]);

  function chooseAnimation(name: string) {
    const next = dimensionByName(dimensions, name);
    onChange({ ...settings, animateBy: name, animationStep: 0, playing: Boolean(next && next.steps.length > 1) });
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
        <output title={animationFrameLabel(animation, step)}>{animationFrameLabel(animation, step)}</output>
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
