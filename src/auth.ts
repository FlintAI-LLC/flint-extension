import type { OAuthProviderId, UserInfo } from "./types.js";
import { ApiError, apiOAuthCallback, apiLogin, apiRefresh } from "./api.js";
import { formatApiErrorMessage } from "./formatApiError.js";
import { waitForOAuthCodeInTab } from "./oauthTab.js";
import {
  buildExtensionOAuthRedirectUri,
  buildGithubAuthUrl,
  buildGoogleAuthUrl,
  buildMicrosoftAuthUrl,
} from "./urls.js";
import {
  clearAuth,
  getAccessToken,
  getExpiresAt,
  getRefreshToken,
  saveAuth,
} from "./storage.js";

const ALARM_NAME = "token-refresh";
const REFRESH_INTERVAL_MINUTES = 25;

// Tokens within this window (ms) of expiry are considered stale.
const EXPIRY_BUFFER_MS = 2 * 60 * 1000;

export async function login(email: string, password: string): Promise<UserInfo> {
  const data = await apiLogin(email, password);
  await saveAuth(data.access_token, data.refresh_token, data.expires_in, data.user);
  await _registerRefreshAlarm();
  return data.user;
}

const PROVIDER_LABELS: Record<OAuthProviderId, string> = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
};

function _buildProviderAuthUrl(provider: OAuthProviderId, redirectUri: string): string {
  switch (provider) {
    case "google":
      return buildGoogleAuthUrl(redirectUri);
    case "github":
      return buildGithubAuthUrl(redirectUri);
    case "microsoft":
      return buildMicrosoftAuthUrl(redirectUri);
  }
}

export async function loginWithProvider(provider: OAuthProviderId): Promise<UserInfo> {
  // Both Chrome and Firefox expose chrome.identity.launchWebAuthFlow, but each
  // browser issues its own redirect URI (Chrome: <id>.chromiumapp.org,
  // Firefox: <uuid>.extensions.allizom.org). The Firefox URI changes per
  // temporary add-on and is impractical to whitelist in Google Cloud Console,
  // so on Firefox we always fall back to the tab-based flow that uses the
  // stable web-app callback. Detect Firefox by its extension URL scheme.
  //
  // GitHub and Microsoft NEVER use chrome.identity, on any browser: GitHub
  // OAuth Apps allow exactly one registered callback URL (no wildcards), and
  // unpacked dev extension IDs change every load, so *.chromiumapp.org can
  // never be registered for GitHub. Microsoft is deliberately kept on the
  // same single tab-capture code path even though Entra could support many
  // redirect URIs — this is a locked architecture decision, not an
  // oversight. Do not add a chrome.identity branch for github/microsoft.
  const isFirefox = chrome.runtime.getURL("/").startsWith("moz-extension://");
  const useChromeIdentity =
    provider === "google" &&
    !isFirefox &&
    typeof chrome.identity?.launchWebAuthFlow === "function";

  let code: string;
  let redirectUri: string;

  if (useChromeIdentity) {
    redirectUri = chrome.identity.getRedirectURL();
    const authUrl = buildGoogleAuthUrl(redirectUri);
    const responseUrl = await new Promise<string>((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
        if (chrome.runtime.lastError ?? !url) {
          reject(new Error(chrome.runtime.lastError?.message ?? "OAuth cancelled"));
        } else {
          resolve(url);
        }
      });
    });
    const parsed = new URL(responseUrl);
    const extracted = parsed.searchParams.get("code");
    if (!extracted) {
      throw new Error(`No authorization code returned from ${PROVIDER_LABELS[provider]}`);
    }
    code = extracted;
  } else {
    redirectUri = buildExtensionOAuthRedirectUri(provider);
    const authUrl = _buildProviderAuthUrl(provider, redirectUri);
    code = await waitForOAuthCodeInTab(authUrl, redirectUri, PROVIDER_LABELS[provider]);
  }

  let data;
  try {
    data = await apiOAuthCallback(provider, code, redirectUri);
  } catch (err) {
    if (err instanceof ApiError) {
      throw new Error(formatApiErrorMessage(err.message, err.message, provider));
    }
    throw err;
  }
  await saveAuth(data.access_token, data.refresh_token, data.expires_in, data.user);
  await _registerRefreshAlarm();
  return data.user;
}

export async function logout(): Promise<void> {
  await clearAuth();
  await chrome.alarms.clear(ALARM_NAME);
}

export async function getAccessTokenOrNull(): Promise<string | null> {
  await refreshIfNeeded();
  return getAccessToken();
}

export async function refreshIfNeeded(): Promise<void> {
  // A benign double-refresh can happen if the alarm-driven refresh and a
  // popup-initiated refreshIfNeeded race. Both paths converge on saveAuth
  // with rotated tokens, so the worst case is one extra refresh request.
  const expiresAt = await getExpiresAt();
  if (expiresAt === null) return;

  const isStale = Date.now() >= expiresAt - EXPIRY_BUFFER_MS;
  if (!isStale) return;

  await _doRefresh();
}

export async function handleRefreshAlarm(alarmName: string): Promise<void> {
  if (alarmName !== ALARM_NAME) return;
  await _doRefresh();
}

async function _doRefresh(): Promise<void> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return;

  try {
    const data = await apiRefresh(refreshToken);
    await saveAuth(data.access_token, data.refresh_token, data.expires_in, data.user);
  } catch {
    // Refresh failure means the session is gone; clear credentials so the
    // popup shows the login form on next open. Storage clear and alarm clear
    // each get their own try/catch so a chrome API hiccup never leaves
    // refresh in a half-failed state silently.
    try {
      await clearAuth();
    } catch {
      // Storage remove failure: best-effort. Next refresh attempt will retry.
    }
    try {
      await chrome.alarms.clear(ALARM_NAME);
    } catch {
      // Alarm clear failure: harmless; the alarm fires at most every 25 min.
    }
  }
}

async function _registerRefreshAlarm(): Promise<void> {
  // Clears any existing alarm before re-registering so we do not stack
  // duplicates after re-login.
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_INTERVAL_MINUTES });
}

export async function ensureRefreshAlarmRegistered(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing) return;

  const token = await getRefreshToken();
  if (token) {
    await _registerRefreshAlarm();
  }
}
