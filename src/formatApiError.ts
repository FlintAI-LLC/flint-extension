import type { OAuthProviderId } from "./types.js";
import { buildExtensionOAuthRedirectUri } from "./urls.js";

const PROVIDER_DISPLAY_NAMES: Record<OAuthProviderId, string> = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
};

const PROVIDER_CLIENT_SECRET_ENV: Record<OAuthProviderId, string> = {
  google: "GOOGLE_CLIENT_SECRET",
  github: "GITHUB_CLIENT_SECRET",
  // Microsoft/Entra settings use the historical Azure AD env var name.
  microsoft: "AZURE_AD_CLIENT_SECRET",
};

/** Human-readable label for a provider value, including non-OAuth "email". */
function providerLabel(value: string): string {
  if (value in PROVIDER_DISPLAY_NAMES) {
    return PROVIDER_DISPLAY_NAMES[value as OAuthProviderId];
  }
  if (value === "email") return "email and password";
  return value;
}

/** Turn extension API error bodies into short user-facing messages. */
export function formatApiErrorMessage(
  body: string,
  fallback: string,
  provider: OAuthProviderId = "google",
): string {
  try {
    const parsed = JSON.parse(body) as {
      detail?:
        | { code?: string; message?: string; with_provider?: string }
        | string;
    };
    const detail = parsed.detail;
    if (typeof detail === "object" && detail !== null) {
      if (detail.code === "invalid_credentials") {
        return (
          "Invalid email or password for this Flint Apply server. " +
          "If you sign in with Google, GitHub, or Microsoft on the website, use that " +
          "sign-in button here instead. " +
          "Local staging (localhost:8001) has its own account database."
        );
      }
      if (detail.code === "totp_not_supported_on_extension") {
        return (
          "Two-factor authentication is not supported in the browser extension yet. " +
          "Sign in at the Flint Apply website to use your account, then return to the extension."
        );
      }
      if (detail.code === "email_already_registered" && detail.with_provider) {
        const withLabel = providerLabel(detail.with_provider);
        return (
          `This email already signs in with ${withLabel} — ` +
          `use Continue with ${withLabel} instead.`
        );
      }
      if (detail.code === "invalid_redirect_uri") {
        const callback = buildExtensionOAuthRedirectUri(provider);
        return (
          "Extension OAuth redirect mismatch. Rebuild and reload the extension, " +
          `then ensure the ${providerLabel(provider)} OAuth app has: ${callback}`
        );
      }
      if (detail.code === "oauth_failed" && detail.message?.includes("invalid_client")) {
        const secretEnv = PROVIDER_CLIENT_SECRET_ENV[provider];
        return (
          `${providerLabel(provider)} client secret is wrong on the backend. ` +
          `Sync ${secretEnv} in backend/.env with root .env, then restart backend.`
        );
      }
      if (detail.message) return detail.message;
      if (detail.code) return detail.code;
    }
    if (typeof detail === "string") return detail;
  } catch {
    // Not JSON — use raw body if short enough.
    if (body.length > 0 && body.length < 200) return body;
  }
  return fallback;
}
