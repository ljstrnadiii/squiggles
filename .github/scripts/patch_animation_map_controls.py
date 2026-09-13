from pathlib import Path

path = Path("apps/web/src/App.tsx")
text = path.read_text()

old_import = 'import { VisualEncodingControls } from "./VisualEncodingControls";\n'
new_import = old_import + 'import { AnimationMapControls } from "./AnimationMapControls";\n'
if old_import not in text:
    raise SystemExit("VisualEncodingControls import not found")
text = text.replace(old_import, new_import, 1)

marker = '  const animationDimension = useMemo(() => dimensionByName(queryDimensions, visualEncoding.animateBy), [queryDimensions, visualEncoding.animateBy]);\n'
playback = marker + '''  useEffect(() => {
    const steps = animationDimension?.steps ?? [];
    if (!visualEncoding.playing || !animationDimension || steps.length < 2) return;
    const step = Math.max(0, Math.min(steps.length - 1, visualEncoding.animationStep));
    const timer = window.setTimeout(() => {
      const next = step + 1;
      if (next < steps.length) setVisualEncoding(current => ({ ...current, animationStep: next }));
      else if (visualEncoding.loop) setVisualEncoding(current => ({ ...current, animationStep: 0 }));
      else setVisualEncoding(current => ({ ...current, playing: false }));
    }, 1000 / visualEncoding.playbackSpeed);
    return () => window.clearTimeout(timer);
  }, [animationDimension, visualEncoding.animationStep, visualEncoding.loop, visualEncoding.playbackSpeed, visualEncoding.playing]);
'''
if marker not in text:
    raise SystemExit("animationDimension marker not found")
text = text.replace(marker, playback, 1)

old_map = '      </>}\n      {spatialDrawing && <><div className="spatial-draw-tools"'
new_map = '      </>}\n      {!spatialDrawing && animationDimension && visualEncoding.showMapControls && animationDimension.steps.length > 0 && <AnimationMapControls dimension={animationDimension} settings={visualEncoding} onChange={setVisualEncoding} />}\n      {spatialDrawing && <><div className="spatial-draw-tools"'
if old_map not in text:
    raise SystemExit("map controls insertion point not found")
text = text.replace(old_map, new_map, 1)

path.write_text(text)
