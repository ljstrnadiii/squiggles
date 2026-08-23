import type { UnitSystem } from "./contracts";

const STORAGE_KEY = "activity-map-units";

export function loadUnits(): UnitSystem {
  const parameter = new URLSearchParams(window.location.search).get("units");
  if (parameter === "metric" || parameter === "imperial") return parameter;
  return localStorage.getItem(STORAGE_KEY) === "imperial" ? "imperial" : "metric";
}

export function saveUnits(units: UnitSystem) {
  localStorage.setItem(STORAGE_KEY, units);
}

export function distanceValue(meters: number, units: UnitSystem) {
  return units === "imperial" ? meters / 1609.344 : meters / 1000;
}

export function distanceUnit(units: UnitSystem) {
  return units === "imperial" ? "mi" : "km";
}

export function elevationValue(meters: number, units: UnitSystem) {
  return units === "imperial" ? meters * 3.28084 : meters;
}

export function elevationUnit(units: UnitSystem) {
  return units === "imperial" ? "ft" : "m";
}
