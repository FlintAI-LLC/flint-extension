/** Parent drawer → popup iframe: re-run JD capture for the current page. */
export const FLINT_PANEL_REFRESH_JD = "FLINT_PANEL_REFRESH_JD";

/**
 * Popup iframe → parent drawer: collapse the floating drawer. Autofill
 * results always render in the page-level overlay (bottom-right), which
 * sits at a lower stacking order than the drawer — without this, the
 * drawer visually buries the result the user just asked for.
 */
export const FLINT_FLOATING_COLLAPSE = "FLINT_FLOATING_COLLAPSE";

/** Content script → page window: selected MyGreenhouse job changed. */
export const FLINT_MYGH_JOB_CHANGED = "FLINT_MYGH_JOB_CHANGED";

export const FLINT_CONTENT_SOURCE = "flint-content";

export const FLINT_JD_REFRESH_EVENT = "flint-jd-refresh";
