import { findMyGreenhouseDetailPanel, isMyGreenhouseHost } from "./myGreenhouseExtract.js";

const REPARENT_ATTR = "data-flint-mgh-ui-reparent";
const FLINT_UI_HOST_SELECTOR =
  "[data-flint-autofill-overlay], [data-flint-floating-shell]";

/** Right-hand flex pane that MyGreenhouse treats as "inside" the open job. */
export function findMyGreenhouseUiMountRoot(doc: Document = document): HTMLElement | null {
  if (!isMyGreenhouseHost(window.location.hostname)) return null;
  const panel = findMyGreenhouseDetailPanel(doc);
  return panel instanceof HTMLElement ? panel : null;
}

export function reparentFlintUiHost(host: HTMLElement): boolean {
  const root = findMyGreenhouseUiMountRoot();
  if (!root) return false;
  if (host.parentElement === root) return true;
  host.dataset.insideMyGreenhousePanel = "1";
  root.appendChild(host);
  return true;
}

/** Move Flint overlays into the open job pane so outside-click dismiss does not fire. */
export function reparentAllFlintUiHosts(doc: Document = document): void {
  if (!isMyGreenhouseHost(window.location.hostname)) return;
  const root = findMyGreenhouseUiMountRoot(doc);
  if (!root) return;

  for (const node of doc.querySelectorAll(FLINT_UI_HOST_SELECTOR)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.parentElement === root) continue;
    node.dataset.insideMyGreenhousePanel = "1";
    root.appendChild(node);
  }
}

export function installMyGreenhouseUiReparentObserver(): void {
  if (!isMyGreenhouseHost(window.location.hostname)) return;
  if (document.documentElement.hasAttribute(REPARENT_ATTR)) return;
  document.documentElement.setAttribute(REPARENT_ATTR, "1");

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      reparentAllFlintUiHosts();
    }, 120);
  };

  reparentAllFlintUiHosts();
  schedule();

  const observer = new MutationObserver(schedule);
  const start = (): void => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
