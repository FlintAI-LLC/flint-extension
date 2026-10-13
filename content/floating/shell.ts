/**
 * Jobright-style floating logo + collapsible in-page drawer.
 *
 * Mounted once per frame via a shadow-DOM host so page CSS cannot bleed in
 * (or the drawer's styles leak out). The drawer hosts the existing popup UI
 * through an extension-origin iframe, so all auth/draft state continues to
 * live in chrome.storage exactly as it does for the toolbar popup today.
 */
import { PRODUCT_NAME, wordmarkUrl } from "../../src/brand.js";
import { isolateExtensionUiClicks } from "../../src/extensionClickIsolation.js";
import {
  findMyGreenhouseUiMountRoot,
  reparentFlintUiHost,
} from "../../src/myGreenhouseUiMount.js";
import { FLINT_CONTENT_SOURCE, FLINT_MYGH_JOB_CHANGED } from "../../src/panelMessages.js";
import {
  currentPageHostname,
  hideFabFor24Hours,
  hideFabOnAllSites,
  hideFabOnSiteForSession,
  shouldShowFab,
} from "../../src/fabVisibility.js";
import { getPanelExpanded, setPanelExpanded } from "./panelState.js";

const HOST_ATTRIBUTE = "data-flint-floating-shell";
const LISTENERS_ATTRIBUTE = "data-flint-floating-listeners";
const COLLAPSE_MESSAGE_TYPE = "FLINT_FLOATING_COLLAPSE";
const DRAWER_WIDTH_PX = 360;
/** Single active controller for document-level listeners (avoids stacked handlers). */
let activeShell: FloatingShell | null = null;

const SHELL_STYLES = `
  :host {
    all: initial;
    display: block;
    position: fixed;
    bottom: 0;
    right: 0;
    width: 0;
    height: 0;
    overflow: visible;
    z-index: 2147483647;
    pointer-events: none;
  }
  .fab,
  .drawer,
  .fab-wrap {
    pointer-events: auto;
  }
  .fab-wrap {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 56px;
    height: 56px;
    z-index: 2147483647;
  }
  .fab-wrap[hidden] {
    display: none;
  }
  .fab {
    position: absolute;
    inset: 0;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #0f766e;
    border: none;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.28);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }
  .fab:hover {
    background: #115e59;
  }
  .fab-dismiss {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid #ffffff;
    background: #334155;
    color: #ffffff;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
  }
  .fab-dismiss:hover {
    background: #1e293b;
  }
  .fab-menu {
    position: absolute;
    bottom: calc(100% + 10px);
    right: 0;
    width: 248px;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.22);
    border: 1px solid #e2e8f0;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fab-menu[hidden] {
    display: none;
  }
  .fab-menu-title {
    font-size: 12px;
    font-weight: 600;
    color: #475569;
    padding: 4px 8px 6px;
  }
  .fab-menu button {
    border: none;
    background: transparent;
    text-align: left;
    font-size: 13px;
    color: #0f172a;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
  }
  .fab-menu button:hover {
    background: #f1f5f9;
  }
  .fab img {
    width: 28px;
    height: 28px;
    display: block;
    pointer-events: none;
  }
  .drawer {
    position: fixed;
    top: 24px;
    bottom: 24px;
    right: 20px;
    width: ${DRAWER_WIDTH_PX}px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 48px);
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 20px 48px rgba(15, 23, 42, 0.28);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 2147483647;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .drawer[hidden] {
    display: none;
  }
  .drawer-header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 44px 16px 16px;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
    flex-shrink: 0;
  }
  .drawer-title {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
  }
  .drawer-wordmark {
    height: 48px;
    width: auto;
    max-width: calc(100% - 8px);
    object-fit: contain;
    display: block;
  }
  .drawer-close {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    border: none;
    background: transparent;
    color: #64748b;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
  }
  .drawer-close:hover {
    background: #e2e8f0;
  }
  .drawer-frame {
    flex: 1;
    border: none;
    width: 100%;
  }
`;

function onDocumentClick(event: MouseEvent): void {
  activeShell?.handleOutsideClick(event);
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") activeShell?.handleEscape();
}

function onFrameMessage(event: MessageEvent): void {
  activeShell?.handleFrameMessage(event);
}

function onPageMessage(event: MessageEvent): void {
  if (event.source !== window) return;
  const data = event.data as { type?: unknown; source?: unknown } | null;
  if (
    data?.type === FLINT_MYGH_JOB_CHANGED &&
    data?.source === FLINT_CONTENT_SOURCE
  ) {
    activeShell?.handleMyGreenhouseJobChanged();
  }
}

function ensureDocumentListeners(): void {
  if (document.documentElement.hasAttribute(LISTENERS_ATTRIBUTE)) return;
  document.documentElement.setAttribute(LISTENERS_ATTRIBUTE, "1");
  // Capture phase so a page's stopPropagation() on bubbling click handlers
  // cannot suppress the outside-click collapse.
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", onDocumentKeydown);
  // Escape inside the extension iframe never bubbles to the parent document —
  // the popup posts FLINT_FLOATING_COLLAPSE instead.
  window.addEventListener("message", onFrameMessage);
  window.addEventListener("message", onPageMessage);
}

let storageListenerRegistered = false;

function ensureStorageListener(): void {
  if (storageListenerRegistered) return;
  storageListenerRegistered = true;
  chrome.storage.onChanged.addListener(() => {
    void activeShell?.refreshFabVisibility();
  });
}

function teardownDocumentListeners(): void {
  document.removeEventListener("click", onDocumentClick, true);
  document.removeEventListener("keydown", onDocumentKeydown);
  window.removeEventListener("message", onFrameMessage);
  window.removeEventListener("message", onPageMessage);
  document.documentElement.removeAttribute(LISTENERS_ATTRIBUTE);
}

export class FloatingShell {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private fabWrap: HTMLElement | null = null;
  private fabButton: HTMLButtonElement | null = null;
  private fabMenuEl: HTMLElement | null = null;
  private drawerEl: HTMLElement | null = null;
  private frameEl: HTMLIFrameElement | null = null;
  private expanded = false;
  /** Set when MyGreenhouse selection changes; next expand remounts the popup. */
  private pendingJobRefresh = false;

  mount(anchor: HTMLElement = document.body): void {
    if (this.host) {
      activeShell = this;
      reparentFlintUiHost(this.host);
      return;
    }

    const existing = document.querySelector(`[${HOST_ATTRIBUTE}]`);
    if (existing instanceof HTMLElement && existing.shadowRoot) {
      // A previous injection already mounted the shell in this frame (e.g. a
      // duplicate chrome.scripting.executeScript call) — reuse the live DOM
      // instead of creating a second overlapping host.
      this.host = existing;
      this.shadow = existing.shadowRoot;
      this.fabWrap = this.shadow.querySelector<HTMLElement>(".fab-wrap");
      this.fabButton = this.shadow.querySelector<HTMLButtonElement>(".fab");
      this.fabMenuEl = this.shadow.querySelector<HTMLElement>(".fab-menu");
      this.drawerEl = this.shadow.querySelector<HTMLElement>(".drawer");
      this.frameEl = this.shadow.querySelector<HTMLIFrameElement>(".drawer-frame");
      this.expanded = Boolean(this.drawerEl && !this.drawerEl.hidden);
      isolateExtensionUiClicks(existing, existing.shadowRoot ?? undefined);
      reparentFlintUiHost(existing);
      activeShell = this;
      ensureDocumentListeners();
      void this.refreshFabVisibility();
      return;
    }

    this.host = document.createElement("div");
    this.host.setAttribute(HOST_ATTRIBUTE, "true");
    this.shadow = this.host.attachShadow({ mode: "open" });
    isolateExtensionUiClicks(this.host, this.shadow);

    const style = document.createElement("style");
    style.textContent = SHELL_STYLES;
    this.shadow.appendChild(style);

    const fabUi = this.buildFabUi();
    this.fabWrap = fabUi.wrap;
    this.fabButton = fabUi.button;
    this.fabMenuEl = fabUi.menu;
    this.drawerEl = this.buildDrawer();

    this.shadow.append(this.fabWrap, this.drawerEl);
    const mountRoot = findMyGreenhouseUiMountRoot() ?? anchor;
    mountRoot.appendChild(this.host);
    reparentFlintUiHost(this.host);

    activeShell = this;
    ensureDocumentListeners();
    ensureStorageListener();
    void this.refreshFabVisibility();
  }

  getHost(): HTMLElement | null {
    return this.host;
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  expand(): void {
    if (!this.host) this.mount();
    activeShell = this;
    this.expanded = true;
    if (this.drawerEl) this.drawerEl.hidden = false;
    if (this.fabWrap) this.fabWrap.hidden = true;
    void setPanelExpanded(true);
    // Re-extract only after the user picks another job — not on every FAB reopen.
    if (this.pendingJobRefresh) {
      this.reloadPanelFrame("job-changed");
      this.pendingJobRefresh = false;
    }
  }

  /** Reload popup iframe so React remounts and re-extracts the current job. */
  reloadPanelFrame(_reason: string): void {
    if (!this.frameEl) return;
    const url = `${chrome.runtime.getURL("popup/index.html")}?flint=${Date.now()}`;
    this.frameEl.src = url;
  }

  /**
   * MyGreenhouse job selection changed — tuck the drawer back to the FAB and
   * mark the popup stale so the next open re-reads the posting.
   */
  handleMyGreenhouseJobChanged(): void {
    this.pendingJobRefresh = true;
    if (this.expanded) {
      this.collapse();
    }
  }

  collapse(): void {
    this.expanded = false;
    if (this.drawerEl) this.drawerEl.hidden = true;
    void setPanelExpanded(false);
    void this.refreshFabVisibility();
  }

  toggle(): void {
    if (this.expanded) this.collapse();
    else this.expand();
  }

  /** Applies the last persisted expand/collapse state for this session. */
  async restorePersistedState(): Promise<void> {
    const shouldExpand = await getPanelExpanded();
    if (!shouldExpand) return;
    if (!this.host) this.mount();
    activeShell = this;
    this.expanded = true;
    if (this.drawerEl) this.drawerEl.hidden = false;
    if (this.fabWrap) this.fabWrap.hidden = true;
    this.reloadPanelFrame("session-restore");
  }

  async refreshFabVisibility(): Promise<void> {
    if (!this.fabWrap || !this.host?.isConnected) return;
    if (this.expanded) {
      this.fabWrap.hidden = true;
      this.closeFabMenu();
      return;
    }
    const show = await shouldShowFab(currentPageHostname());
    if (!this.fabWrap || !this.host?.isConnected) return;
    this.fabWrap.hidden = !show;
    if (!show) this.closeFabMenu();
  }

  handleOutsideClick(event: MouseEvent): void {
    if (!this.host) return;
    if (event.composedPath().includes(this.host)) {
      return;
    }
    this.closeFabMenu();
    if (!this.expanded) return;
    this.collapse();
  }

  handleEscape(): void {
    if (this.expanded) this.collapse();
  }

  handleFrameMessage(event: MessageEvent): void {
    if (!this.expanded || !this.frameEl) return;
    if (event.source !== this.frameEl.contentWindow) return;
    const data = event.data as { type?: unknown } | null;
    if (!data || data.type !== COLLAPSE_MESSAGE_TYPE) return;
    this.collapse();
  }

  destroy(): void {
    if (activeShell === this) {
      activeShell = null;
      teardownDocumentListeners();
    }
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.fabWrap = null;
    this.fabButton = null;
    this.fabMenuEl = null;
    this.drawerEl = null;
    this.frameEl = null;
    this.expanded = false;
  }

  private closeFabMenu(): void {
    if (this.fabMenuEl) this.fabMenuEl.hidden = true;
  }

  private toggleFabMenu(): void {
    if (!this.fabMenuEl) return;
    this.fabMenuEl.hidden = !this.fabMenuEl.hidden;
  }

  private async applyFabHide(mode: "site_session" | "snooze" | "global"): Promise<void> {
    const host = currentPageHostname();
    if (mode === "site_session") await hideFabOnSiteForSession(host);
    else if (mode === "snooze") await hideFabFor24Hours();
    else await hideFabOnAllSites();
    this.closeFabMenu();
    if (this.expanded) this.collapse();
    await this.refreshFabVisibility();
  }

  private buildFabUi(): { wrap: HTMLElement; button: HTMLButtonElement; menu: HTMLElement } {
    const wrap = document.createElement("div");
    wrap.className = "fab-wrap";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "fab";
    button.setAttribute("aria-label", `Open ${PRODUCT_NAME}`);
    const icon = document.createElement("img");
    icon.src = chrome.runtime.getURL("icons/icon48.png");
    icon.alt = PRODUCT_NAME;
    button.appendChild(icon);
    button.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.closeFabMenu();
        this.expand();
      },
      true,
    );

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "fab-dismiss";
    dismiss.setAttribute("aria-label", `Hide ${PRODUCT_NAME} button`);
    dismiss.textContent = "\u00d7";
    dismiss.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleFabMenu();
      },
      true,
    );

    const menu = document.createElement("div");
    menu.className = "fab-menu";
    menu.hidden = true;

    const title = document.createElement("p");
    title.className = "fab-menu-title";
    title.textContent = "Hide floating button";

    const siteBtn = document.createElement("button");
    siteBtn.type = "button";
    siteBtn.textContent = "On this site until I close the browser";
    siteBtn.addEventListener("click", () => void this.applyFabHide("site_session"));

    const snoozeBtn = document.createElement("button");
    snoozeBtn.type = "button";
    snoozeBtn.textContent = "On all sites for 24 hours";
    snoozeBtn.addEventListener("click", () => void this.applyFabHide("snooze"));

    const globalBtn = document.createElement("button");
    globalBtn.type = "button";
    globalBtn.textContent = "On all sites until I turn it back on";
    globalBtn.addEventListener("click", () => void this.applyFabHide("global"));

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.closeFabMenu());

    menu.append(title, siteBtn, snoozeBtn, globalBtn, cancelBtn);
    wrap.append(button, dismiss, menu);

    return { wrap, button, menu };
  }

  private buildDrawer(): HTMLElement {
    const drawer = document.createElement("div");
    drawer.className = "drawer";
    drawer.hidden = true;

    const header = document.createElement("div");
    header.className = "drawer-header";

    const title = document.createElement("div");
    title.className = "drawer-title";
    const wordmark = document.createElement("img");
    wordmark.className = "drawer-wordmark";
    wordmark.src = wordmarkUrl();
    wordmark.alt = "";
    title.append(wordmark);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "drawer-close";
    closeButton.setAttribute("aria-label", `Close ${PRODUCT_NAME} panel`);
    closeButton.textContent = "\u00d7";
    closeButton.addEventListener("click", () => this.collapse());

    header.append(title, closeButton);

    this.frameEl = document.createElement("iframe");
    this.frameEl.className = "drawer-frame";
    this.frameEl.src = chrome.runtime.getURL("popup/index.html");
    this.frameEl.title = PRODUCT_NAME;

    drawer.append(header, this.frameEl);
    return drawer;
  }
}
