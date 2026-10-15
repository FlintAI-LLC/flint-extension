export const AUTOFILL_KILL_SWITCH_KEY = "flint_autofill_disabled";

export async function isAutofillEnabled(): Promise<boolean> {
  const result = await chrome.storage.local.get(AUTOFILL_KILL_SWITCH_KEY);
  return result[AUTOFILL_KILL_SWITCH_KEY] !== true;
}

export function isGreenhouseHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "greenhouse.io" || host.endsWith(".greenhouse.io");
  } catch {
    return false;
  }
}

export function isLinkedInHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

/**
 * True when the URL matches an autofill-runner content_scripts host in
 * manifest.json (Greenhouse, Lever, Ashby, Workday, iCIMS, UKG, Jobright,
 * LinkedIn /jobs/*). Used by the popup to enable Autofill (beta).
 */
export function isAutofillHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) return true;
    if (host === "lever.co" || host.endsWith(".lever.co")) return true;
    if (host === "ashbyhq.com" || host.endsWith(".ashbyhq.com")) return true;
    // Only the external career-site domain. *.myworkday.com is the employee
    // HRIS (payroll, personal info) and must not be an autofill surface.
    if (host === "myworkdayjobs.com" || host.endsWith(".myworkdayjobs.com")) return true;
    if (host === "icims.com" || host.endsWith(".icims.com")) return true;
    if (host === "ukg.net" || host.endsWith(".ukg.net")) return true;
    if (host === "jobright.ai" || host === "www.jobright.ai") return true;

    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      return path === "/jobs" || path.startsWith("/jobs/");
    }

    return false;
  } catch {
    return false;
  }
}
