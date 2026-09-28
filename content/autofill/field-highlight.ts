/** Highlight a form control without scrolling (avoids Greenhouse "lose progress?" guards). */

import { querySelectorDeep } from "./fill-utils.js";

const HIGHLIGHT_MS = 1_800;

export function highlightFieldAtSelector(root: ParentNode, selector: string): boolean {
  const el = querySelectorDeep(root, selector);
  if (!(el instanceof HTMLElement)) return false;

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
