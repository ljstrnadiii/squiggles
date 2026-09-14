import type { QueryDimension } from "./contracts";
import { animationFrameLabel, animationStepIndex, type VisualEncodingSettings } from "./visualEncoding";

function steppedSpeed(speed: number, direction: -1 | 1) {
  const delta = speed < 1 ? 0.1 : speed < 10 ? 1 : 5;
  const next = speed + direction * delta;
  return Math.min(240, Math.max(0.1, Number(next.toFixed(next < 1 ? 1 : 2))));
}

export function AnimationMapControls({ dimension, settings, onChange }: {
  dimension: QueryDimension;
  settings: VisualEncodingSettings;
  onChange: (settings: VisualEncodingSettings) => void;
}) {
  const steps = dimension.steps;
  if (!steps.length) return null;
  const step = animationStepIndex(dimension, settings.animationStep);
  const frameLabel = animationFrameLabel(dimension, step);

  return <div className="map-animation-controls" role="group" aria-label="Animation playback controls">
    <button type="button" className="map-animation-play" aria-label={settings.playing ? "Pause animation" : "Play animation"} onClick={() => onChange({ ...settings, playing: !settings.playing })}>{settings.playing ? "Ⅱ" : "▶"}</button>
    <input aria-label="Animation frame" type="range" min="0" max={Math.max(0, steps.length - 1)} value={step} onChange={event => onChange({ ...settings, animationStep: Number(event.target.value), playing: false })} />
    <output title={frameLabel}>{frameLabel}</output>
    <div className="map-animation-speed" role="group" aria-label="Animation speed">
      <button type="button" aria-label="Slow animation down" title="Slower" disabled={settings.playbackSpeed <= 0.1} onClick={() => onChange({ ...settings, playbackSpeed: steppedSpeed(settings.playbackSpeed, -1) })}>←</button>
      <span>{settings.playbackSpeed} fps</span>
      <button type="button" aria-label="Speed animation up" title="Faster" disabled={settings.playbackSpeed >= 240} onClick={() => onChange({ ...settings, playbackSpeed: steppedSpeed(settings.playbackSpeed, 1) })}>→</button>
    </div>
  </div>;
}
