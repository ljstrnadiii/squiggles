import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { RenderSettingsControls } from "./RenderSettingsControls";
import { DEFAULT_RENDER_SETTINGS, loadRenderSettings, saveRenderSettings } from "./renderSettings";
describe("rendering controls", () => {
  beforeEach(() => localStorage.clear());
  it("persists independent controls and resets them", () => {
    function Settings() {
      const [settings, setSettings] = useState(loadRenderSettings);
      return <RenderSettingsControls settings={settings} onChange={next => { setSettings(next); saveRenderSettings(next); }} />;
    }
    render(<Settings />);
    fireEvent.change(screen.getByLabelText("3D terrain detail"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Route LOD bias"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Custom vertex budget"), { target: { value: "500000" } });
    expect(loadRenderSettings()).toMatchObject({ terrainDetail: 1.5, imageryDetail: 2, lodBias: 1, vertexBudget: 500000 });
    fireEvent.click(screen.getByText("Reset rendering settings"));
    expect(loadRenderSettings()).toEqual(DEFAULT_RENDER_SETTINGS);
  });
  it("clamps corrupted storage and handles invalid JSON", () => {
    localStorage.setItem("activity-map.render-settings.v1", '{"terrainDetail":100,"pixelError":-1}');
    expect(loadRenderSettings()).toMatchObject({ terrainDetail: 2, pixelError: 0.25, lodBias: 0 });
    localStorage.setItem("activity-map.render-settings.v1", "bad json");
    expect(loadRenderSettings()).toEqual(DEFAULT_RENDER_SETTINGS);
  });
});
