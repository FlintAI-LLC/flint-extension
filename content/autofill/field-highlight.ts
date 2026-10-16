/**
 * Highlight a form control for "jump to field".
 *
 * Uses `Element.scrollIntoView` (a pure viewport-scroll API with no
 * navigation/history side effects) rather than `focus()`'s own auto-scroll,
 * so this cannot trigger Greenhouse's "lose progress?" *navigation* guard —
 * that guard fires on route/hash changes, not on scrolling. Skipping the
 * scroll entirely (the previous behavior) left "jump to field" focusing an
 * off-screen element with no visible effect, which is indistinguishable from
 * doing nothing.
 */

import { querySelectorDeep } from "./fill-utils.js";

const HIGHLIGHT_MS = 1_800;

export function highlightFieldAtSelector(root: ParentNode, selector: string): boolean {
  const el = querySelectorDeep(root, selector);
  if (!(el instanceof HTMLElement)) return false;

  if (typeof el.scrollIntoView === "function") {
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      // Some embedded contexts restrict smooth-scroll options.
      try {
        el.scrollIntoView();
      } catch {
        // Best-effort — fall through to focus/highlight regardless.
      }
    }
  }

  if (typeof el.focus === "function") {
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }

  if (typeof el.animate === "function") {
    el.animate(
      [
        { outline: "3px solid #0f766e", outlineOffset: "2px" },
        { outline: "3px solid transparent", outlineOffset: "2px" },
      ],
      { duration: HIGHLIGHT_MS, easing: "ease-out" },
    );
  }

  return true;
}
