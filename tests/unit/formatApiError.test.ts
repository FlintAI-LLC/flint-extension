import { describe, expect, it } from "vitest";
import { formatApiErrorMessage } from "../../src/formatApiError.js";
import { buildExtensionOAuthRedirectUri } from "../../src/urls.js";

describe("formatApiErrorMessage", () => {
  it("maps TOTP restriction to a clear extension login message", () => {
    const message = formatApiErrorMessage(
      JSON.stringify({ detail: { code: "totp_not_supported_on_extension" } }),
      "Login failed",
    );
    expect(message).toContain("Two-factor authentication");
    expect(message).toContain("Flint Apply website");
  });

  it("maps invalid_credentials to a login-specific message", () => {
    const message = formatApiErrorMessage(
      JSON.stringify({ detail: { code: "invalid_credentials" } }),
      "Session expired — please log in again.",
    );
    expect(message).toContain("Invalid email or password");
    expect(message).not.toContain("Session expired");
  });

  it("uses the configured web app URL for OAuth redirect help", () => {
    const callback = buildExtensionOAuthRedirectUri();
    const message = formatApiErrorMessage(
      JSON.stringify({ detail: { code: "invalid_redirect_uri" } }),
      "OAuth failed",
    );
    expect(message).toContain(callback);
    expect(message).not.toContain("localhost:3000");
  });
});
