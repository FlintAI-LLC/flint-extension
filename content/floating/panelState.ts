import { isExtensionContextValid } from "../../src/extensionContext.js";

/**
 * Persists whether the floating drawer is expanded so the panel state
 * survives a content-script remount (SPA navigation, tab reload) within the
 * same browser session. chrome.storage.session is preferred because it is
 * cleared on browser restart; older Firefox releases predating the
 * storage.session API fall back to chrome.storage.local.
 */

export const FLOATING_PANEL_EXPANDED_KEY = "flint_floating_panel_expanded";

function getSessionArea(): chrome.storage.StorageArea | null {
  return typeof chrome !== "undefined" && chrome.storage && "session" in chrome.storage
    ? chrome.storage.session
    : null;
}

export async function getPanelExpanded(): Promise<boolean> {
  if (!isExtensionContextValid()) return false;
  const session = getSessionArea();
  if (session) {
    try {
      const result = await session.get(FLOATING_PANEL_EXPANDED_KEY);
      const value = result[FLOATING_PANEL_EXPANDED_KEY];
      if (typeof value === "boolean") return value;
    } catch {
      // Fall through to local storage below.
    }
  }

  try {
    const result = await chrome.storage.local.get(FLOATING_PANEL_EXPANDED_KEY);
    return result[FLOATING_PANEL_EXPANDED_KEY] === true;
  } catch {
    return false;
  }
}

export async function setPanelExpanded(expanded: boolean): Promise<void> {
  if (!isExtensionContextValid()) return;
  const session = getSessionArea();
  if (session) {
    try {
      await session.set({ [FLOATING_PANEL_EXPANDED_KEY]: expanded });
      return;
    } catch {
      // Fall through to local storage below.
    }
  }

  try {
    await chrome.storage.local.set({ [FLOATING_PANEL_EXPANDED_KEY]: expanded });
  } catch {
    // Best-effort persistence only — the in-memory shell state still applies.
  }
}
