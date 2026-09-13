import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GoogleSignInButton } from "./GoogleSignInButton";

describe("GoogleSignInButton", () => {
  it("renders Google branding and starts the existing login flow", () => {
    const onClick = vi.fn();
    render(<GoogleSignInButton onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
