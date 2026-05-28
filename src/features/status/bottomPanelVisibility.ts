import { bottomPanelVisibilityStorageKey } from "../../constants";

export function loadBottomPanelVisible() {
  return localStorage.getItem(bottomPanelVisibilityStorageKey) === "true";
}

export function writeBottomPanelVisible(visible: boolean) {
  localStorage.setItem(bottomPanelVisibilityStorageKey, String(visible));
}
