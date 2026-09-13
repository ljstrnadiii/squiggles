import { customPalette, visualPaletteStops, type VisualPalette } from "./visualEncoding";

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
