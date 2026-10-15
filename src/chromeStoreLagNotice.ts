/** Public Chrome Web Store build while a newer zip is in review (update when CWS goes live). */
export const CHROME_WEB_STORE_LIVE_VERSION = "0.1.35";

/** Latest dev zip on flintapply.com/extension — keep in sync with manifest.json. */
export const RECOMMENDED_DEV_BUILD_VERSION = "0.1.41";

function parseSemverTriple(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Show upgrade nudge when the installed build is at or below the live Store listing. */
export function shouldShowChromeStoreLagNotice(installedVersion: string): boolean {
  const installed = parseSemverTriple(installedVersion);
  const recommended = parseSemverTriple(RECOMMENDED_DEV_BUILD_VERSION);
  if (!installed || !recommended) return true;
  for (let i = 0; i < 3; i++) {
    if (installed[i] < recommended[i]) return true;
    if (installed[i] > recommended[i]) return false;
  }
  return false;
}

export function chromeStoreLagNoticeBody(storeLive = CHROME_WEB_STORE_LIVE_VERSION): string {
  return `Chrome Web Store is still on v${storeLive} while review catches up. For autofill and the newest fixes, use Developer mode and install the latest zip from flintapply.com/extension (v${RECOMMENDED_DEV_BUILD_VERSION}+).`;
}
