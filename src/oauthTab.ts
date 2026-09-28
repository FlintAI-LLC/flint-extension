/**
 * Open a provider's OAuth authorization page in a tab and capture the
 * authorization code when the provider redirects to the dedicated extension
 * callback page for that provider (not the NextAuth route).
 *
 * Listens via tabs.onUpdated, webNavigation.onCommitted, AND polls the tab URL
 * every 400ms. The polling fallback exists because in Firefox temporary add-ons
 * the navigation events sometimes don't fire on cross-origin redirects, leaving
 * the user stranded on the callback page.
 */
const POLL_INTERVAL_MS = 400;
const MAX_WAIT_MS = 5 * 60 * 1000;

export async function waitForOAuthCodeInTab(
  authUrl: string,
  redirectUri: string,
  providerLabel = "Google",
): Promise<string> {
  const redirectPrefix = redirectUri.split("?")[0];
  const webNavigationCommitted = chrome.webNavigation?.onCommitted;

  return new Promise((resolve, reject) => {
    let authTabId: number | undefined;
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      webNavigationCommitted?.removeListener(onCommitted);
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const tryCapture = (tabId: number, url: string | undefined): void => {
      if (authTabId === undefined || tabId !== authTabId) return;
      if (!url?.startsWith(redirectPrefix)) return;

      void chrome.tabs.remove(tabId).catch(() => undefined);

      const parsed = new URL(url);
      const error = parsed.searchParams.get("error");
      if (error) {
        finish(() => {
          reject(
            new Error(
              parsed.searchParams.get("error_description") ??
                `${providerLabel} sign-in failed (${error})`,
            ),
          );
        });
        return;
      }

      const code = parsed.searchParams.get("code");
      if (!code) {
        finish(() =>
          reject(new Error(`No authorization code returned from ${providerLabel}`)),
        );
        return;
      }

      finish(() => resolve(code));
    };

    const onUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ): void => {
      tryCapture(tabId, changeInfo.url ?? tab.url);
    };

    const onCommitted = (
      details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
    ): void => {
      tryCapture(details.tabId, details.url);
    };

    const onRemoved = (tabId: number): void => {
      if (tabId !== authTabId) return;
      finish(() => reject(new Error("OAuth cancelled")));
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    webNavigationCommitted?.addListener(onCommitted);

    timeoutTimer = setTimeout(() => {
      finish(() => reject(new Error("OAuth timed out — please try again.")));
    }, MAX_WAIT_MS);

    chrome.tabs.create({ url: authUrl }, (tab) => {
      if (chrome.runtime.lastError ?? !tab?.id) {
        finish(() => {
          reject(
            new Error(
              chrome.runtime.lastError?.message ?? "Failed to open sign-in tab",
            ),
          );
        });
        return;
      }
      authTabId = tab.id;

      if (tab.url) tryCapture(tab.id, tab.url);

      // Polling fallback: in Firefox temporary add-ons, tabs.onUpdated and
      // webNavigation.onCommitted sometimes miss the OAuth redirect to a
      // host outside the extension's own origin. Polling chrome.tabs.get
      // every 400ms guarantees we still see the URL change.
      pollTimer = setInterval(() => {
        if (settled || authTabId === undefined) return;
        chrome.tabs.get(authTabId, (liveTab) => {
          if (chrome.runtime.lastError || !liveTab?.url) return;
          tryCapture(authTabId as number, liveTab.url);
        });
      }, POLL_INTERVAL_MS);
    });
  });
}
