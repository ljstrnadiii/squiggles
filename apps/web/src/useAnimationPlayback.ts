import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { QueryDimension } from "./contracts";
import type { VisualEncodingSettings } from "./visualEncoding";

export function useAnimationPlayback(
  dimension: QueryDimension | undefined,
  settings: VisualEncodingSettings,
  setSettings: Dispatch<SetStateAction<VisualEncodingSettings>>,
) {
  useEffect(() => {
    const steps = dimension?.steps ?? [];
    if (!settings.playing || !dimension || steps.length < 2) return;
    const step = Math.max(0, Math.min(steps.length - 1, settings.animationStep));
    const timer = window.setTimeout(() => {
      const next = step + 1;
      if (next < steps.length) setSettings(current => ({ ...current, animationStep: next }));
      else if (settings.loop) setSettings(current => ({ ...current, animationStep: 0 }));
      else setSettings(current => ({ ...current, playing: false }));
    }, 1000 / settings.playbackSpeed);
    return () => window.clearTimeout(timer);
  }, [dimension, setSettings, settings.animationStep, settings.loop, settings.playbackSpeed, settings.playing]);
}
