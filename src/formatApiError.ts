import { buildExtensionOAuthRedirectUri } from "./urls.js";

/** Turn extension API error bodies into short user-facing messages. */
export function formatApiErrorMessage(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as {
      detail?: { code?: string; message?: string } | string;
    };
    const detail = parsed.detail;
    if (typeof detail === "object" && detail !== null) {
      if (detail.code === "totp_not_supported_on_extension") {
        return (
          "Two-factor authentication is not supported in the browser extension yet. " +
          "Sign in at the Flint Apply website to use your account, then return to the extension."
        );
      }
      if (detail.code === "invalid_redirect_uri") {
        const callback = buildExtensionOAuthRedirectUri();
        return (
          "Extension OAuth redirect mismatch. Rebuild and reload the extension, " +
          `then ensure Google Console has: ${callback}`
        );
      }
      if (detail.code === "oauth_failed" && detail.message?.includes("invalid_client")) {
        return "Google client secret is wrong on the backend. Sync GOOGLE_CLIENT_SECRET in backend/.env with root .env, then restart backend.";
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
