import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { extensionInvalidatedMessage } from "../src/extensionContext.js";
import { FLINT_JD_REFRESH_EVENT, FLINT_PANEL_REFRESH_JD } from "../src/panelMessages.js";
import { Popup } from "./Popup.js";

class PopupErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    console.error("[FlintApply popup]", error);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error.message ?? String(this.state.error);
    const friendly = msg.includes("Extension context invalidated")
      ? extensionInvalidatedMessage()
      : msg;
    return (
      <div className="popup">
        <p className="error-text">{friendly}</p>
      </div>
    );
  }
}

const COLLAPSE_MESSAGE_TYPE = "FLINT_FLOATING_COLLAPSE";

// When hosted in the floating drawer iframe, Escape never reaches the parent
// document — bridge it so the shell can collapse to the logo.
if (window.parent !== window) {
  document.documentElement.classList.add("flint-in-drawer");
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    window.parent.postMessage({ type: COLLAPSE_MESSAGE_TYPE }, "*");
  });
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data as { type?: unknown; reason?: string } | null;
    if (data?.type !== FLINT_PANEL_REFRESH_JD) return;
    window.dispatchEvent(
      new CustomEvent(FLINT_JD_REFRESH_EVENT, { detail: { reason: data.reason ?? "panel" } }),
    );
  });
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <PopupErrorBoundary>
        <Popup />
      </PopupErrorBoundary>
    </React.StrictMode>,
  );
}
