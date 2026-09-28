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

  it("uses the configured web app URL for OAuth redirect help (default provider: google)", () => {
    const callback = buildExtensionOAuthRedirectUri("google");
    const message = formatApiErrorMessage(
      JSON.stringify({ detail: { code: "invalid_redirect_uri" } }),
      "OAuth failed",
    );
    expect(message).toContain(callback);
    expect(message).not.toContain("localhost:3000");
  });

  it("threads the provider through to the OAuth redirect help message", () => {
    const callback = buildExtensionOAuthRedirectUri("github");
    const message = formatApiErrorMessage(
      JSON.stringify({ detail: { code: "invalid_redirect_uri" } }),
      "OAuth failed",
      "github",
    );
    expect(message).toContain(callback);
    expect(message).toContain("GitHub");
  });

  it("maps email_already_registered to a provider-specific message using with_provider", () => {
    const message = formatApiErrorMessage(
      JSON.stringify({
        detail: { code: "email_already_registered", with_provider: "google" },
      }),
      "Registration failed",
      "github",
    );
    expect(message).toContain("Google");
    expect(message).toContain("Continue with Google");
  });

  it("maps email_already_registered with_provider: email to a readable label", () => {
    const message = formatApiErrorMessage(
      JSON.stringify({
        detail: { code: "email_already_registered", with_provider: "email" },
      }),
      "Registration failed",
      "microsoft",
    );
    expect(message).toContain("email and password");
  });
});
