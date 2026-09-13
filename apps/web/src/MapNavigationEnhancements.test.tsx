import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapNavigationEnhancements } from "./MapNavigationEnhancements";

const mocks = vi.hoisted(() => ({
  likeMap: vi.fn(async (...args: [unknown, unknown, string]) => { void args; }),
  unlikeMap: vi.fn(async (...args: [unknown, unknown, string]) => { void args; }),
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
  document.querySelector('nav.mobile-menu[aria-label="Query navigation"]')?.remove();
  document.querySelector('section.toolbar[aria-label="Query and map settings"]')?.remove();
  mocks.likeMap.mockClear();
  mocks.unlikeMap.mockClear();
});

function nativeHeader() {
  const header = document.createElement("header");
  header.className = "topbar";
  header.innerHTML = `
    <div class="brand"></div>
    <button class="mobile-query-title" aria-expanded="false">Over the years</button>
    <button class="map-identity-button" aria-expanded="false">
      <span class="map-owner-avatar"><img src="https://example.test/martha.jpg" /></span>
      <strong>Martha</strong>
    </button>`;
  document.body.appendChild(header);
  return header;
}

function nativeQueryNavigation() {
  const menu = document.createElement("nav");
  menu.className = "mobile-menu utility-panel";
  menu.setAttribute("aria-label", "Query navigation");
  menu.innerHTML = `<button>New query</button><button>Query settings</button>`;
  document.body.appendChild(menu);
  return menu;
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

  it("opens the flat settings menu and searchable Favorites without stealing focus", async () => {
    window.history.replaceState({}, "", "/m/22222222-2222-2222-2222-222222222222");
    nativeHeader();
    render(<MapNavigationEnhancements />);

    fireEvent.click(await screen.findByRole("button", { name: "Open account menu" }));
    const menu = screen.getByRole("navigation", { name: "Account navigation" });
    expect(menu).toHaveTextContent("My mapFavoritesAccountUploadShareLogout");
    expect(menu).not.toHaveTextContent("Recent");

    fireEvent.click(screen.getByRole("button", { name: /Favorites/ }));
    const favorites = screen.getByRole("dialog", { name: "Favorites" });
    expect(favorites).toHaveClass("maps-pane");
    expect(favorites).toHaveTextContent("Alex");
    const search = screen.getByPlaceholderText("Search favorites");
    expect(search).not.toHaveFocus();
    fireEvent.change(search, { target: { value: "nope" } });
    await waitFor(() => expect(screen.queryByText("Alex")).not.toBeInTheDocument());
  });

  it("keeps map views simple and exposes edit and new-map actions for the owner", async () => {
    window.history.replaceState({}, "", "/m/11111111-1111-1111-1111-111111111111");
    const header = nativeHeader();
    const navigation = nativeQueryNavigation();
    const nativeTrigger = header.querySelector<HTMLButtonElement>("button.mobile-query-title")!;
    const querySettings = [...navigation.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Query settings")!;
    const newQuery = [...navigation.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "New query")!;
    const triggerClicked = vi.fn();
    const settingsClicked = vi.fn();
    const newQueryClicked = vi.fn();
    nativeTrigger.addEventListener("click", triggerClicked);
    querySettings.addEventListener("click", settingsClicked);
    newQuery.addEventListener("click", newQueryClicked);
    render(<MapNavigationEnhancements />);

    const context = await screen.findByRole("button", { name: "Open Len map views" });
    fireEvent.click(context);
    const dropdown = screen.getByRole("dialog", { name: "Map owner and views" });
    const currentView = within(dropdown).getByRole("button", { name: "Over the years" });
    expect(currentView.querySelector("svg")).toBeNull();
    expect(within(dropdown).getByRole("button", { name: "Edit current map" })).toBeInTheDocument();
    expect(within(dropdown).getByRole("button", { name: "+ New map" })).toBeInTheDocument();

    fireEvent.click(within(dropdown).getByRole("button", { name: "Edit current map" }));
    await waitFor(() => expect(settingsClicked).toHaveBeenCalledTimes(1));
    expect(triggerClicked).toHaveBeenCalledTimes(1);

    fireEvent.click(context);
    const reopened = screen.getByRole("dialog", { name: "Map owner and views" });
    fireEvent.click(within(reopened).getByRole("button", { name: "+ New map" }));
    await waitFor(() => expect(newQueryClicked).toHaveBeenCalledTimes(1));
  });
});
