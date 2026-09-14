import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueryDimension } from "./contracts";
import { DEFAULT_VISUAL_ENCODING, type VisualEncodingSettings } from "./visualEncoding";
import { useAnimationPlayback } from "./useAnimationPlayback";

const month: QueryDimension = {
  name: "month",
  kind: "temporal",
  values: { a: "Jan", b: "Feb" },
  steps: ["Jan", "Feb"],
};

afterEach(() => vi.useRealTimers());

describe("useAnimationPlayback", () => {
  it("advances frames at the configured speed", () => {
    vi.useFakeTimers();
    let settings: VisualEncodingSettings = { ...DEFAULT_VISUAL_ENCODING, animateBy: "month", playing: true, playbackSpeed: 4 };
    const setSettings = vi.fn((update: React.SetStateAction<VisualEncodingSettings>) => {
      settings = typeof update === "function" ? update(settings) : update;
    });

    renderHook(() => useAnimationPlayback(month, settings, setSettings));
    act(() => vi.advanceTimersByTime(250));

    expect(settings.animationStep).toBe(1);
  });

  it("loops or pauses at the last frame", () => {
    vi.useFakeTimers();
    let settings: VisualEncodingSettings = { ...DEFAULT_VISUAL_ENCODING, animateBy: "month", animationStep: 1, playing: true, playbackSpeed: 2, loop: false };
    const setSettings = vi.fn((update: React.SetStateAction<VisualEncodingSettings>) => {
      settings = typeof update === "function" ? update(settings) : update;
    });

    renderHook(() => useAnimationPlayback(month, settings, setSettings));
    act(() => vi.advanceTimersByTime(500));

    expect(settings.playing).toBe(false);
  });
});
