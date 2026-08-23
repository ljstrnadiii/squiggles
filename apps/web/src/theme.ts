import type { ThemeMode } from "./contracts";

const KEY = "activity-map.theme.v1";

export function loadTheme(): ThemeMode {
  const stored = localStorage.getItem(KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function saveTheme(theme: ThemeMode) {
  localStorage.setItem(KEY, theme);
}
