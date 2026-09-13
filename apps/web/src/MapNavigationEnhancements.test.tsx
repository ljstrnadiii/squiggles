import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapNavigationEnhancements } from "./MapNavigationEnhancements";

const mockTabs = [
  { id: "all", title: "Map" },
  { id: "years", title: "Over the years" },
];

const mocks = vi.hoisted(() => ({
  likeMap: vi.fn(async (...args: [unknown, unknown, string]) => { void args; }),
  unlikeMap: vi.fn(async (...args: [unknown, unknown, string]) => { void args; }),
  saveTabs: vi.fn(),
  selectMapView: vi.fn(),
  editMapView: vi.fn(),
  createMapView: vi.fn(),
  openMapStatistics: vi.fn(),
  openMapTable: vi.fn(),
}));

vi.mock("./auth", () => ({
  beginGoogleLogin: vi.fn(),
  clearSession: vi.fn(),
  identityFromSession: () => ({ name: "Len", email: "len@example.com", picture: "https://example.test/len.jpg" }),
  loadSession: () => ({ accessToken: "access", idToken: "id" }),
  loadRuntimeConfig: async () => ({ apiUrl: "https://api.example.test", cognitoDomain: "", cognitoClientId: "" }),
}));

vi.mock("./mapIdentity", () => ({
  likeMap: (...args: [unknown, unknown, string]) => mocks.likeMap(...args),
  unlikeMap: (...args: [unknown, unknown, string]) => mocks.unlikeMap(...args),
  loadMapNavigation: async () => ({
    myMap: { mapId: "11111111", ownerDisplayName: "Len", viewerRole: "owner", url: "/p/11111111" },
    recentMaps: [
      { mapId: "33333333", ownerDisplayName: "Alex", viewerRole: "viewer", url: "/p/33333333", lastViewedAt: "2026-09-11T12:00:00Z" },
    ],
  }),
}));

vi.mock("./mapViewController", () => ({
  mapViewNavigationState: () => ({ activeId: "years", views: [{ id: "all", title: "Map" }, { id: "years", title: "Over the years" }] }),
  subscribeMapViewNavigation: () => () => undefined,
  selectMapView: (...args: unknown[]) => mocks.selectMapView(...args),
  editMapView: (...args: unknown[]) => mocks.editMapView(...args),
  createMapView: (...args: unknown[]) => mocks.createMapView(...args),
  openMapStatistics: (...args: unknown[]) => mocks.openMapStatistics(...args),
  openMapTable: (...args: unknown[]) => mocks.openMapTable(...args),
}));

vi.mock("./publishing", () => ({
  loadPublishedView: async () => ({
    mapId: "11111111",
    url: "/p/11111111",
    tabs: mockTabs,
    active: "years",
    datasetId: "dataset",
    updatedAt: "2026-09-13T12:00:00Z",
    identity: { mapId: "11111111", ownerDisplayName: "Len", viewerRole: "owner" },
  }),
}));

vi.mock("./storage", () => ({
  mapStorageScope: () => "published:22222222",
  loadTabs: () => mockTabs,
  saveTabs: (...args: unknown[]) => mocks.saveTabs(...args),
}));

afterEach(() => {
  cleanup();
  document.querySelector("header.topbar")?.remove();
  document.querySelector('section.toolbar[aria-label="Query and map settings"]')?.remove();
  mocks.likeMap.mockClear();
  mocks.unlikeMap.mockClear();
  mocks.saveTabs.mockClear();
  mocks.selectMapView.mockClear();
  mocks.editMapView.mockClear();
  mocks.createMapView.mockClear();
  mocks.openMapStatistics.mockClear();
  mocks.openMapTable.mockClear();
});

function nativeHeader() {
  const header = document.createElement("header");
  header.className = "topbar";
  header.innerHTML = `
    <div class="brand"></div>
    <button class="map-identity-button" aria-expanded="false">
      <span class="map-owner-avatar"><img src="https://example.test/martha.jpg" /></span>
      <strong>Martha</strong>
    </button>`;
  document.body.appendChild(header);
  return header;
}

describe("MapNavigationEnhancements", () => {
  it("uses one map-context avatar and likes someone else's map", async () => {
    window.history.replaceState({}, "", "/p/22222222");
    nativeHeader();
    render(<MapNavigationEnhancements />);

    const context = await screen.findByRole("button", { name: "Open Martha map views" });
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share map" })).not.toBeInTheDocument();
    fireEvent.click(context);
    expect(screen.getByRole("dialog", { name: "Map owner and views" })).toHaveTextContent("Martha");
    expect(screen.getByRole("dialog", { name: "Map owner and views" })).toHaveTextContent("Over the years");

    fireEvent.click(screen.getByRole("button", { name: /Like map/ }));
    await waitFor(() => expect(mocks.likeMap).toHaveBeenCalledWith(expect.anything(), expect.anything(), "22222222"));
  });

  it("opens the flat settings menu and searchable Favorites without stealing focus", async () => {
    window.history.replaceState({}, "", "/p/22222222");
    nativeHeader();
    render(<MapNavigationEnhancements />);

    fireEvent.click(await screen.findByRole("button", { name: "Open account menu" }));
    const menu = screen.getByRole("navigation", { name: "Account navigation" });
    expect(menu).toHaveTextContent("My mapFavoritesAccountUploadLogout");
    expect(menu).not.toHaveTextContent("Recent");
    expect(menu).not.toHaveTextContent("Share");

    fireEvent.click(screen.getByRole("button", { name: /Favorites/ }));
    const favorites = screen.getByRole("dialog", { name: "Favorites" });
    expect(favorites).toHaveClass("maps-pane");
    expect(favorites).toHaveTextContent("Alex");
    const search = screen.getByPlaceholderText("Search favorites");
    expect(search).not.toHaveFocus();
    fireEvent.change(search, { target: { value: "nope" } });
    await waitFor(() => expect(screen.queryByText("Alex")).not.toBeInTheDocument());
  });

  it("switches saved map views directly through the view controller", async () => {
    window.history.replaceState({}, "", "/p/11111111");
    nativeHeader();
    render(<MapNavigationEnhancements />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Len map views" }));
    const dropdown = screen.getByRole("dialog", { name: "Map owner and views" });
    fireEvent.click(within(dropdown).getByRole("button", { name: "Map" }));
    expect(mocks.selectMapView).toHaveBeenCalledWith("all");
  });

  it("keeps current-map tools in the compact view menu", async () => {
    window.history.replaceState({}, "", "/p/11111111");
    nativeHeader();
    render(<MapNavigationEnhancements />);

    const context = await screen.findByRole("button", { name: "Open Len map views" });
    fireEvent.click(context);
    let dropdown = screen.getByRole("dialog", { name: "Map owner and views" });
    fireEvent.click(within(dropdown).getByRole("button", { name: "Statistics" }));
    expect(mocks.openMapStatistics).toHaveBeenCalledTimes(1);

    fireEvent.click(context);
    dropdown = screen.getByRole("dialog", { name: "Map owner and views" });
    fireEvent.click(within(dropdown).getByRole("button", { name: "Table" }));
    expect(mocks.openMapTable).toHaveBeenCalledTimes(1);
  });

  it("syncs published views and owns edit/new view actions without a legacy query menu", async () => {
    window.history.replaceState({}, "", "/p/11111111");
    nativeHeader();
    render(<MapNavigationEnhancements />);

    const context = await screen.findByRole("button", { name: "Open Len map views" });
    expect(await screen.findByRole("button", { name: "Saved — map settings and view are up to date" })).toHaveClass("saved");
    await waitFor(() => expect(mocks.saveTabs).toHaveBeenCalledWith(mockTabs, "published:22222222"));
    expect(screen.getByRole("button", { name: "Share map" })).toBeInTheDocument();

    fireEvent.click(context);
    const dropdown = screen.getByRole("dialog", { name: "Map owner and views" });
    const currentView = within(dropdown).getByRole("button", { name: "Over the years" });
    expect(currentView.querySelector("svg")).toBeNull();
    expect(within(dropdown).getByRole("button", { name: "Edit current map" })).toBeInTheDocument();
    expect(within(dropdown).getByRole("button", { name: "+ New map" })).toBeInTheDocument();

    fireEvent.click(within(dropdown).getByRole("button", { name: "Edit current map" }));
    expect(mocks.editMapView).toHaveBeenCalledWith("years");

    fireEvent.click(context);
    const reopened = screen.getByRole("dialog", { name: "Map owner and views" });
    fireEvent.click(within(reopened).getByRole("button", { name: "+ New map" }));
    expect(mocks.createMapView).toHaveBeenCalledTimes(1);
  });

  it("uses the same compact view menu without a published map id", async () => {
    window.history.replaceState({}, "", "/");
    nativeHeader();
    render(<MapNavigationEnhancements />);

    const context = await screen.findByRole("button", { name: "Open map views" });
    fireEvent.click(context);
    const dropdown = screen.getByRole("dialog", { name: "Map owner and views" });
    expect(within(dropdown).getByRole("button", { name: "Edit current map" })).toBeInTheDocument();
    expect(within(dropdown).getByRole("button", { name: "+ New map" })).toBeInTheDocument();
  });
});
