/**
 * Entry point for the floating panel content script. Mounts the FAB +
 * drawer shell, restores the last persisted expand state for this session,
 * and listens for EXPAND_FLOATING_PANEL messages sent by the background
 * service worker when the toolbar action is clicked.
 */
import { installFlintUiClickGuard } from "../../src/extensionClickIsolation.js";
import { installMyGreenhouseUiReparentObserver } from "../../src/myGreenhouseUiMount.js";
import { FloatingShell } from "./shell.js";

installFlintUiClickGuard();
installMyGreenhouseUiReparentObserver();

declare global {
  interface Window {
    __flintFloatingShellStarted?: boolean;
  }
}

let shellInstance: FloatingShell | null = null;

function getFloatingShell(): FloatingShell {
  if (!shellInstance) {
    shellInstance = new FloatingShell();
    shellInstance.mount();
  }
  return shellInstance;
}

if (!window.__flintFloatingShellStarted) {
  window.__flintFloatingShellStarted = true;

  getFloatingShell()
    .restorePersistedState()
    .catch(() => {
      // Best-effort restore only — the shell stays collapsed on failure.
    });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return false;
    if ((message as { type?: unknown }).type !== "EXPAND_FLOATING_PANEL") return false;

    getFloatingShell().expand();
    sendResponse({ ok: true });
    return false;
  });
} else {
  // Duplicate executeScript injection — reuse the existing shell and expand.
  getFloatingShell().expand();
}

export {};
