import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapNavigationEnhancements } from "./MapNavigationEnhancements";

vi.mock("./auth", () => ({
  loadSession: () => ({ accessToken: "access", idToken: "id" }),
  loadRuntimeConfig: async () => ({ apiUrl: "https://api.example.test", cognitoDomain: "", cognitoClientId: "" }),
}));

vi.mock("./mapIdentity", () => ({
  loadMapNavigation: async () => ({
    myMap: { mapId: "11111111-1111-1111-1111-111111111111", ownerDisplayName: "Len", viewerRole: "owner", url: "/m/11111111-1111-1111-1111-111111111111" },
    recentMaps: [
      { mapId: "22222222-2222-2222-2222-222222222222", ownerDisplayName: "Martha", viewerRole: "viewer", url: "/m/22222222-2222-2222-2222-222222222222", lastViewedAt: "2026-09-12T12:00:00Z" },
      { mapId: "33333333-3333-3333-3333-333333333333", ownerDisplayName: "Alex", viewerRole: "viewer", url: "/m/33333333-3333-3333-3333-333333333333", lastViewedAt: "2026-09-11T12:00:00Z" },
    ],
  }),
}));

afterEach(() => cleanup());

describe("MapNavigationEnhancements", () => {
  it("replaces inline recents with a searchable recent-map picker", async () => {
    window.history.replaceState({}, "", "/m/11111111-1111-1111-1111-111111111111");
    const menu = document.createElement("nav");
    menu.className = "account-menu";
    menu.setAttribute("aria-label", "Map and account navigation");
    document.body.appendChild(menu);

    render(<MapNavigationEnhancements />);
    const recent = await screen.findByRole("button", { name: "Recent maps (2)…" });
    expect(screen.getByRole("button", { name: "Share map" })).toBeInTheDocument();
    fireEvent.click(recent);
    expect(screen.getByRole("dialog", { name: "Recent maps" })).toBeInTheDocument();
    expect(screen.getByText("Martha")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search people or map ID"), { target: { value: "Alex" } });
    await waitFor(() => expect(screen.queryByText("Martha")).not.toBeInTheDocument());
    expect(screen.getByText("Alex")).toBeInTheDocument();

    menu.remove();
  });
});
