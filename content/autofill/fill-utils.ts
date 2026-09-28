/** Shared DOM write helpers for autofill engines. */

import { forEachElementIncludingShadow } from "../../src/shadowDomWalk.js";

export function dispatchInputEvents(el: HTMLElement): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

export function setTextControlValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
  dispatchInputEvents(el);
}

export function setSelectByVisibleText(select: HTMLSelectElement, value: string): boolean {
  const target = value.trim().toLowerCase();
  for (const option of Array.from(select.options)) {
    const text = option.textContent?.trim().toLowerCase() ?? "";
    if (text === target || option.value.toLowerCase() === target) {
      select.value = option.value;
      dispatchInputEvents(select);
      return true;
    }
  }
  return false;
}

export function querySelectorSafe(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/** Light DOM + open shadow roots (MyGreenhouse widgets). */
export function querySelectorDeep(root: ParentNode, selector: string): Element | null {
  const direct = querySelectorSafe(root, selector);
  if (direct) return direct;

  const searchRoot =
    root instanceof Document
      ? root.body ?? root.documentElement
      : root instanceof Element
        ? root
        : null;
  if (!searchRoot) return null;

  let found: Element | null = null;
  forEachElementIncludingShadow(searchRoot, (el) => {
    if (found) return;
    try {
      if (el.matches(selector)) found = el;
    } catch {
      // Selector may be invalid for this element type.
    }
  });
  return found;
}
