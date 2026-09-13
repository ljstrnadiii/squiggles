import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapNavigationEnhancements } from "./MapNavigationEnhancements";

const mocks = vi.hoisted(() => ({
  likeMap: vi.fn(async () => undefined),
  unlikeMap: vi.fn(async () => undefined),
}));

vi.mock("./auth", () => ({
  clearSession: vi.fn(),
  identityFromSession: () => ({ name: "Len", email: "len@example.com", picture: "https://example.test/len.jpg" }),
  loadSession: () => ({ accessToken: "access", idToken: "id" }),
  loadRuntimeConfig: async () => ({ apiUrl: "https://api.example.test", cognitoDomain: "", cognitoClientId: "" }),
}));

vi.mock("./mapIdentity", () => ({
  likeMap: (...args: [unknown, unknown, string]) => mocks.likeMap(...args),
  unlikeMap: (...args: [unknown, unknown, string]) => mocks.unlikeMap(...args),
  loadMapNavigation: async () => ({
    myMap: { mapId: "11111111-1111-1111-1111-111111111111", ownerDisplayName: "Len", viewerRole: "owner", url: "/m/11111111-1111-1111-1111-111111111111" },
    recentMaps: [
      { mapId: "33333333-3333-3333-3333-333333333333", ownerDisplayName: "Alex", viewerRole: "viewer", url: "/m/33333333-3333-3333-3333-333333333333", lastViewedAt: "2026-09-11T12:00:00Z" },
    ],
  }),
}));

vi.mock("./storage", () => ({
  mapStorageScope: () => "map:22222222-2222-2222-2222-222222222222",
  loadTabs: () => [
    { id: "all", title: "Map" },
    { id: "years", title: "Over the years" },
  ],
}));

afterEach(() => {
  cleanup();
  document.querySelector("header.topbar")?.remove();
  mocks.likeMap.mockClear();
  mocks.unlikeMap.mockClear();
});

function nativeHeader() {
  const header = document.createElement("header");
  header.className = "topbar";
  header.innerHTML = `
    <div class="brand"></div>
    <button class="mobile-query-title">Over the years</button>
    <button class="map-identity-button" aria-expanded="false">
      <span class="map-owner-avatar"><img src="https://example.test/martha.jpg" /></span>
      <strong>Martha</strong>
    </button>`;
  document.body.appendChild(header);
  return header;
}

describe("MapNavigationEnhancements", () => {
  it("uses one map-context avatar and likes someone else's map", async () => {
    window.history.replaceState({}, "", "/m/22222222-2222-2222-2222-222222222222");
    nativeHeader();
    render(<MapNavigationEnhancements />);

    const context = await screen.findByRole("button", { name: "Open Martha map views" });
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeInTheDocument();
    fireEvent.click(context);
    expect(screen.getByRole("dialog", { name: "Map owner and views" })).toHaveTextContent("Martha");
    expect(screen.getByRole("dialog", { name: "Map owner and views" })).toHaveTextContent("Over the years");

    fireEvent.click(screen.getByRole("button", { name: /Like map/ }));
    await waitFor(() => expect(mocks.likeMap).toHaveBeenCalledWith(expect.anything(), expect.anything(), "22222222-2222-2222-2222-222222222222"));
  });

  it("opens the flat settings menu and searchable Favorites", async () => {
    window.history.replaceState({}, "", "/m/22222222-2222-2222-2222-222222222222");
    nativeHeader();
    render(<MapNavigationEnhancements />);

    fireEvent.click(await screen.findByRole("button", { name: "Open account menu" }));
    const menu = screen.getByRole("navigation", { name: "Account navigation" });
    expect(menu).toHaveTextContent("My mapFavoritesAccountUploadShareLogout");
    expect(menu).not.toHaveTextContent("Recent");

    fireEvent.click(screen.getByRole("button", { name: /Favorites/ }));
    expect(screen.getByRole("dialog", { name: "Favorites" })).toHaveTextContent("Alex");
    fireEvent.change(screen.getByPlaceholderText("Search favorites"), { target: { value: "nope" } });
    await waitFor(() => expect(screen.queryByText("Alex")).not.toBeInTheDocument());
  });
});
