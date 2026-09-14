import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QueryDimension } from "./contracts";
import { AnimationMapControls } from "./AnimationMapControls";
import { DEFAULT_VISUAL_ENCODING } from "./visualEncoding";

const month: QueryDimension = {
  name: "month_year",
  kind: "temporal",
  values: { a: "Jan 2026", b: "Feb 2026" },
  steps: ["Jan 2026", "Feb 2026"],
};

describe("AnimationMapControls", () => {
  it("shows the dimension with the current value and arrow speed controls", () => {
    const onChange = vi.fn();
    const settings = {
      ...DEFAULT_VISUAL_ENCODING,
      animateBy: month.name,
      animationStep: 1,
      playbackSpeed: 8,
      playing: true,
    };

    render(<AnimationMapControls dimension={month} settings={settings} onChange={onChange} />);

    expect(screen.getByText("month_year = Feb 2026")).toBeInTheDocument();
    expect(screen.getByText("8 fps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slow animation down" })).toHaveTextContent("←");
    expect(screen.getByRole("button", { name: "Speed animation up" })).toHaveTextContent("→");

    fireEvent.click(screen.getByRole("button", { name: "Slow animation down" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ playbackSpeed: 7 }));
  });
});
