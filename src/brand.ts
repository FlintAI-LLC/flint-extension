/** User-facing Flint Apply product name (with space). Web app uses "FlintApply" in code. */
export const PRODUCT_NAME = "Flint Apply";

/** Separate desktop interview co-pilot — not Flint Apply. */
export const FLINT_DESKTOP_NAME = "Flint";

/** Desktop deep-link handoff — enable when Flint interview app is deployed. */
export const FLINT_DESKTOP_HANDOFF_ENABLED = false;

const WORDMARK = "brand/wordmark-light-256.png";

export function wordmarkUrl(): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(WORDMARK);
  }
  return `/brand/wordmark-light-256.png`;
}
