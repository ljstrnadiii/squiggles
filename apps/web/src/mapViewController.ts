export type MapViewNavigationItem = {
  id: string;
  title: string;
};

export type MapViewNavigationState = {
  activeId: string | null;
  views: MapViewNavigationItem[];
};

type MapViewActions = {
  select: (id: string) => void;
  edit: (id: string) => void;
  create: () => void;
};

const EMPTY_STATE: MapViewNavigationState = { activeId: null, views: [] };

let state = EMPTY_STATE;
let actions: MapViewActions | null = null;
const listeners = new Set<() => void>();

function sameState(left: MapViewNavigationState, right: MapViewNavigationState) {
  return left.activeId === right.activeId
    && left.views.length === right.views.length
    && left.views.every((view, index) => view.id === right.views[index]?.id && view.title === right.views[index]?.title);
}

export function mapViewNavigationState() {
  return state;
}

export function subscribeMapViewNavigation(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateMapViewNavigation(next: MapViewNavigationState) {
  if (sameState(state, next)) return;
  state = next;
  listeners.forEach(listener => listener());
}

export function setMapViewActions(next: MapViewActions) {
  actions = next;
}

export function clearMapViewActions() {
  actions = null;
  updateMapViewNavigation(EMPTY_STATE);
}

export function selectMapView(id: string) {
  actions?.select(id);
}

export function editMapView(id: string) {
  actions?.edit(id);
}

export function createMapView() {
  actions?.create();
}
