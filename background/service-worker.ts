import {
  ensureRefreshAlarmRegistered,
  getAccessTokenOrNull,
  handleRefreshAlarm,
  loginWithGoogle,
} from "../src/auth.js";
import {
  fetchAutofillPayload,
  fetchRecentTailoredSessions,
} from "../src/autofillApi.js";
import { openFlintDeepLink } from "../src/flintDeepLink.js";
import { FLINT_DESKTOP_HANDOFF_ENABLED } from "../src/brand.js";
import { injectAndExpandFloatingPanel } from "../src/floatingPanelInject.js";
import { formatApiErrorMessage } from "../src/formatApiError.js";
import { extractJobPostingFromHtml } from "../src/jdParse.js";
import type {
  GoogleLoginResult,
  InjectJdExtractorResult,
  ParseJdFromUrlResult,
  PopupMessage,
} from "../src/types.js";

// Re-register the refresh alarm on every service worker instantiation
// (install, update, and post-termination wake-up). The MV3 `activate` event
// only fires on install/update — not on every cold start — so registering at
// module top-level guarantees alarm survival across SW restarts even when
// chrome.alarms persistence is dropped after long idle periods.
ensureRefreshAlarmRegistered().catch(() => {
  // Non-fatal: next popup open will detect the expired token.
});

chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
  handleRefreshAlarm(alarm.name).catch(() => {
    // Refresh failure is handled inside handleRefreshAlarm (clears auth).
  });
});

// Chrome ships with no default_popup so this fires on click; Firefox keeps
// default_popup (restored by scripts/patch-firefox-manifest.mjs) so this
// listener is simply unused there.
chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
  void injectAndExpandFloatingPanel(tab.id);
});

const SW_FETCH_TIMEOUT_MS = 4000;

async function _fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SW_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener(
  (message: PopupMessage, _sender, sendResponse) => {
    if (message.type === "PARSE_JD_FROM_URL") {
      _fetchWithTimeout(message.url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      })
        .then((response) => {
          if (!response.ok) {
            sendResponse({ error: `HTTP ${response.status}` } satisfies ParseJdFromUrlResult);
            return;
          }
          return response.text().then((html) => {
            const jd = extractJobPostingFromHtml(html);
            if (jd && jd.text.trim().length >= 200) {
              sendResponse({ jd } satisfies ParseJdFromUrlResult);
            } else {
              sendResponse({ error: "No JobPosting JSON-LD found" } satisfies ParseJdFromUrlResult);
            }
          });
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : "Fetch failed";
          sendResponse({ error } satisfies ParseJdFromUrlResult);
        });
      return true;
    }

    if (message.type === "FETCH_PAGE_HTML") {
      _fetchWithTimeout(message.url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      })
        .then((response) => {
          if (!response.ok) {
            sendResponse({ error: `HTTP ${response.status}` });
            return;
          }
          return response.text().then((html) => sendResponse({ html }));
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : "Fetch failed";
          sendResponse({ error });
        });
      return true;
    }

    if (message.type === "FETCH_JSON") {
      let fetchUrl: URL;
      try {
        fetchUrl = new URL(message.url);
      } catch {
        sendResponse({ error: "Invalid URL" });
        return true;
      }
      if (fetchUrl.protocol !== "https:" || fetchUrl.hostname !== "boards-api.greenhouse.io") {
        sendResponse({ error: "URL not allowlisted" });
        return true;
      }

      _fetchWithTimeout(message.url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      })
        .then(async (response) => {
          if (!response.ok) {
            sendResponse({ error: `HTTP ${response.status}` });
            return;
          }
          const json = (await response.json()) as Record<string, unknown>;
          sendResponse({ json });
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : "Fetch failed";
          sendResponse({ error });
        });
      return true;
    }

    if (message.type === "OPEN_FLINT_DEEP_LINK") {
      if (!FLINT_DESKTOP_HANDOFF_ENABLED) {
        sendResponse({ ok: false, error: "Desktop handoff disabled" });
        return true;
      }
      openFlintDeepLink(message.url).catch(() => {
        // Non-fatal: user can retry from the popup.
      });
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "INJECT_JD_EXTRACTOR") {
      chrome.tabs.sendMessage(message.tabId, { type: "JD_EXTRACTOR_PING" }, (ping) => {
        if (!chrome.runtime.lastError && ping && (ping as { ok?: boolean }).ok) {
          sendResponse({ ok: true } satisfies InjectJdExtractorResult);
          return;
        }
        chrome.scripting
          .executeScript({
            target: { tabId: message.tabId },
            files: ["content/jd-extractor.js"],
          })
          .then(() => {
            sendResponse({ ok: true } satisfies InjectJdExtractorResult);
          })
          .catch((err: unknown) => {
            const error = err instanceof Error ? err.message : "Script injection failed";
            sendResponse({ ok: false, error } satisfies InjectJdExtractorResult);
          });
      });
      return true;
    }

    if (message.type === "FETCH_AUTOFILL_PAYLOAD") {
      void getAccessTokenOrNull()
        .then(async (token) => {
          if (!token) {
            sendResponse({ error: "Not logged in", code: "not_authenticated" });
            return;
          }
          const result = await fetchAutofillPayload(message.jdId, token);
          if (!result.ok) {
            sendResponse({
              error:
                result.code === "not_tailored"
                  ? "Autofill payload not available until the resume is tailored"
                  : "Autofill payload not available",
              code: result.code,
            });
            return;
          }
          sendResponse({ payload: result.payload });
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : "Fetch failed";
          sendResponse({ error });
        });
      return true;
    }

    if (message.type === "FETCH_RECENT_TAILORED_SESSIONS") {
      void getAccessTokenOrNull()
        .then(async (token) => {
          if (!token) {
            sendResponse({ error: "Not logged in", sessions: [] });
            return;
          }
          const sessions = await fetchRecentTailoredSessions(token);
          sendResponse({ sessions });
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : "Fetch failed";
          sendResponse({ error, sessions: [] });
        });
      return true;
    }

    if (message.type !== "GOOGLE_LOGIN") return false;

    // Firefox also implements launchWebAuthFlow, so feature-detection on the
    // API surface returns the wrong answer. Detect via extension URL scheme:
    // chrome-extension:// for Chromium, moz-extension:// for Firefox.
    const isFirefox = chrome.runtime.getURL("/").startsWith("moz-extension://");

    if (isFirefox) {
      // Send { pending: true } synchronously so the popup's sendMessage callback
      // gets a real response and stops retrying. We then return false (channel
      // closed) — this is safe because sendResponse was already called before
      // the async work starts, so Firefox never emits "Promised response went
      // out of scope". The popup switches to its storage.onChanged listener to
      // detect when auth completes.
      const pendingResult: GoogleLoginResult = { success: false, error: "", pending: true };
      sendResponse(pendingResult);

      loginWithGoogle()
        .then((): void => {
          // Token was already saved to storage by loginWithGoogle() → saveAuth().
          // The popup's onStorageChanged listener picks up sr_access_token.
        })
        .catch((err: unknown) => {
          const raw = err instanceof Error ? err.message : "Google sign-in failed";
          void chrome.storage.local.set({ sr_oauth_error: formatApiErrorMessage(raw, raw) });
        });

      return false;
    }

    loginWithGoogle()
      .then((user): void => {
        const result: GoogleLoginResult = { success: true, user };
        sendResponse(result);
      })
      .catch((err: unknown): void => {
        const raw = err instanceof Error ? err.message : "Google sign-in failed";
        const error = formatApiErrorMessage(raw, raw);
        const result: GoogleLoginResult = { success: false, error };
        sendResponse(result);
      });

    return true;
  },
);
