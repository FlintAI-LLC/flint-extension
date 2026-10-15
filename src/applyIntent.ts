/** Must match smart-resume `applyOnEmployerSiteModel` intent query params. */
const FLINT_APPLY_EMPLOYER_INTENT_PARAM = "flintapply";
const FLINT_APPLY_EMPLOYER_INTENT_VALUE = "apply";

/** True when the tab was opened from Flint Apply “Apply on employer site”. */
export function isFlintApplyApplyIntent(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get(FLINT_APPLY_EMPLOYER_INTENT_PARAM) === FLINT_APPLY_EMPLOYER_INTENT_VALUE;
  } catch {
    return false;
  }
}
