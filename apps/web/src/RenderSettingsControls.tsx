import { DEFAULT_RENDER_SETTINGS, type RenderSettings } from "./renderSettings";

export function RenderSettingsControls({ settings, onChange }: { settings: RenderSettings; onChange: (settings: RenderSettings) => void }) {
  const update = (patch: Partial<RenderSettings>) => onChange({ ...settings, ...patch });
  return <fieldset className="render-settings">
    <legend>Rendering</legend>
    <label className="check"><input type="checkbox" checked={settings.fillBudget} onChange={event => update({ fillBudget: event.target.checked })} />Use available vertex budget</label>
    <label>Route error target (CSS pixels)<input aria-label="Route error target" type="number" min="0.25" max="2" step="0.25" disabled={settings.fillBudget} value={settings.pixelError} onChange={event => update({ pixelError: Number(event.target.value) })} /></label>
    <label>Route LOD bias<input aria-label="Route LOD bias" type="range" min="-1" max="1" step="1" value={settings.lodBias} onChange={event => update({ lodBias: Number(event.target.value) })} /><output>{settings.lodBias > 0 ? "+" : ""}{settings.lodBias}</output></label>
    <label>Custom vertex budget<input aria-label="Custom vertex budget" type="number" min="50000" max="3000000" step="50000" placeholder="Use resolution preset" value={settings.vertexBudget ?? ""} onChange={event => update({ vertexBudget: event.target.value === "" ? null : Number(event.target.value) })} /></label>
    <label>3D imagery detail<input aria-label="3D imagery detail" type="range" min="0" max="2" step="0.25" value={settings.imageryDetail} onChange={event => update({ imageryDetail: Number(event.target.value) })} /><output>+{settings.imageryDetail.toFixed(2)} zoom</output></label>
    <label>3D terrain detail<input aria-label="3D terrain detail" type="range" min="0" max="2" step="0.25" value={settings.terrainDetail} onChange={event => update({ terrainDetail: Number(event.target.value) })} /><output>+{settings.terrainDetail.toFixed(2)} zoom</output></label>
    <p>Request finer tiles earlier in pitched views, within source limits. Each extra zoom level can substantially increase tile loading.</p>
    <button type="button" onClick={() => onChange({ ...DEFAULT_RENDER_SETTINGS })}>Reset rendering settings</button>
  </fieldset>;
}
