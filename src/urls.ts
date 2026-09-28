import type { OAuthProviderId } from "./types.js";

// Direct import.meta.env access is required so Vite's static-analysis
// substitution can replace these at build time. Indirect access via a cast
// or object spread bypasses the substitution and always resolves to "".
export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
}

export function getWebAppBaseUrl(): string {
  return import.meta.env.VITE_WEB_APP_BASE_URL ?? "http://localhost:3100";
}

export function getGoogleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
}

export function getGithubClientId(): string {
  return import.meta.env.VITE_GITHUB_CLIENT_ID ?? "";
}

export function getMicrosoftClientId(): string {
  return import.meta.env.VITE_MICROSOFT_CLIENT_ID ?? "";
}

export function buildTailorInFlintApplyUrl(
  jdId: string,
  options?: { reviewRecommended?: boolean },
): string {
  const base = getWebAppBaseUrl().replace(/\/$/, "");
  const params = new URLSearchParams({
    jd_id: jdId,
    source: "extension",
    step: "jd",
  });
  if (options?.reviewRecommended) {
    params.set("jd_review", "1");
  }
  return `${base}/session/new?${params.toString()}`;
}

export type { OAuthProviderId };

/**
 * Dedicated extension callback — must not use the NextAuth route.
 *
 * Google, GitHub, and Microsoft each get their own stable callback path
 * (``/auth/extension/{provider}/callback``). This is a locked architecture
 * decision for GitHub in particular: GitHub OAuth Apps allow exactly one
 * registered callback URL (no wildcards), and unpacked dev extension IDs
 * change every load, so a ``*.chromiumapp.org`` redirect can never be
 * registered for GitHub. Microsoft is kept on the same single code path
 * deliberately, even though Entra could support many redirect URIs, so
 * there is exactly one non-Google OAuth code path to maintain.
 */
export function buildExtensionOAuthRedirectUri(provider: OAuthProviderId): string {
  const base = getWebAppBaseUrl().replace(/\/$/, "");
  return `${base}/auth/extension/${provider}/callback`;
}

/**
 * Build the Google OAuth authorization URL opened in a sign-in tab.
 *
 * The ``redirectUri`` must match a URI registered on the same Google OAuth
 * client as the web app — see ``buildExtensionOAuthRedirectUri()``.
 */
export function buildGoogleAuthUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Build the GitHub OAuth authorization URL opened in a sign-in tab.
 *
 * GitHub always uses the tab-capture flow (never chrome.identity) — see
 * ``buildExtensionOAuthRedirectUri()`` for why.
 */
export function buildGithubAuthUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: getGithubClientId(),
    redirect_uri: redirectUri,
    scope: "read:user user:email",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Build the Microsoft (Entra ID) OAuth authorization URL opened in a
 * sign-in tab.
 *
 * Microsoft always uses the tab-capture flow (never chrome.identity), kept
 * on the same single code path as GitHub even though Entra could support
 * many redirect URIs registered directly.
 */
export function buildMicrosoftAuthUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile User.Read offline_access",
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}
