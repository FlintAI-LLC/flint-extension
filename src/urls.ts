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

/** Dedicated extension callback — must not use the NextAuth route. */
export function buildExtensionOAuthRedirectUri(): string {
  const base = getWebAppBaseUrl().replace(/\/$/, "");
  return `${base}/auth/extension/google/callback`;
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
