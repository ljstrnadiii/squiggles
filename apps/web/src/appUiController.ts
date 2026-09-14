type AppUiActions = {
  account: () => void;
  upload: () => void;
  saveView: () => void;
};

let actions: AppUiActions | null = null;

export function setAppUiActions(next: AppUiActions) {
  actions = next;
}

export function clearAppUiActions() {
  actions = null;
}

export function openAccountPanel() {
  actions?.account();
}

export function openUploadPanel() {
  actions?.upload();
}

export function saveCurrentMapView() {
  actions?.saveView();
}
