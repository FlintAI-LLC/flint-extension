const ISOLATED_ATTR = "data-flint-click-isolated";
const GUARD_ATTR = "data-flint-click-guard-installed";

const FLINT_UI_SELECTOR =
  "[data-flint-autofill-overlay], [data-flint-floating-shell]";

function isFlintUiEvent(event: Event): boolean {
  const path =
    typeof event.composedPath === "function"
      ? event.composedPath()
      : [event.target];
  return path.some(
    (node) =>
      node instanceof Element &&
      (node.matches(FLINT_UI_SELECTOR) || Boolean(node.closest(FLINT_UI_SELECTOR))),
  );
}

/**
 * Bubble-phase guard so host pages (MyGreenhouse flex) do not see Flint UI
 * clicks. Must NOT run in capture phase — that blocks events before they
 * reach shadow-DOM buttons (FAB / Autofill).
 */
export function installFlintUiClickGuard(): void {
  if (document.documentElement.hasAttribute(GUARD_ATTR)) return;
  document.documentElement.setAttribute(GUARD_ATTR, "1");

  const guard = (event: Event): void => {
    if (!isFlintUiEvent(event)) return;
    // Bubble phase only — stop other document listeners (e.g. MyGreenhouse dismiss).
    event.stopImmediatePropagation();
  };

  for (const type of ["pointerdown", "mousedown", "mouseup", "click"] as const) {
    document.addEventListener(type, guard, false);
  }
}

/** Stop Flint UI clicks from bubbling to the host page (bubble phase). */
export function isolateExtensionUiClicks(
  host: HTMLElement,
  shadow?: ShadowRoot,
): void {
  if (host.hasAttribute(ISOLATED_ATTR)) return;
  host.setAttribute(ISOLATED_ATTR, "1");

  const swallow = (event: Event): void => {
    event.stopPropagation();
  };

  for (const type of ["pointerdown", "mousedown", "mouseup", "click"] as const) {
    host.addEventListener(type, swallow, false);
    shadow?.addEventListener(type, swallow, false);
  }
}
