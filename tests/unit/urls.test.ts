import { describe, it, expect } from "vitest";
import {
  buildExtensionOAuthRedirectUri,
  buildGithubAuthUrl,
  buildMicrosoftAuthUrl,
  buildTailorInFlintApplyUrl,
  getWebAppBaseUrl,
} from "../../src/urls.js";

describe("buildExtensionOAuthRedirectUri", () => {
  it("uses a dedicated callback path separate from NextAuth", () => {
    const base = getWebAppBaseUrl().replace(/\/$/, "");
    expect(buildExtensionOAuthRedirectUri("google")).toBe(
      `${base}/auth/extension/google/callback`,
    );
  });

  it("builds a per-provider callback path for github", () => {
    const base = getWebAppBaseUrl().replace(/\/$/, "");
    expect(buildExtensionOAuthRedirectUri("github")).toBe(
      `${base}/auth/extension/github/callback`,
    );
  });

  it("builds a per-provider callback path for microsoft", () => {
    const base = getWebAppBaseUrl().replace(/\/$/, "");
    expect(buildExtensionOAuthRedirectUri("microsoft")).toBe(
      `${base}/auth/extension/microsoft/callback`,
    );
  });
});

describe("buildGithubAuthUrl", () => {
  it("targets GitHub's authorize endpoint with read:user user:email scope", () => {
    const url = new URL(buildGithubAuthUrl("https://example.com/auth/extension/github/callback"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.com/auth/extension/github/callback",
    );
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
  });
});

describe("buildMicrosoftAuthUrl", () => {
  it("targets the common Microsoft authorize endpoint with the expected scopes", () => {
    const url = new URL(
      buildMicrosoftAuthUrl("https://example.com/auth/extension/microsoft/callback"),
    );
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.com/auth/extension/microsoft/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(
      "openid email profile User.Read offline_access",
    );
  });
});

describe("buildTailorInFlintApplyUrl", () => {
  it("opens Flint Apply wizard with extension jd_id", () => {
    const base = getWebAppBaseUrl().replace(/\/$/, "");
    const url = buildTailorInFlintApplyUrl("e689d8ad-382f-42c6-a8eb-da3da4964c2c");
    expect(url).toBe(
      `${base}/session/new?jd_id=e689d8ad-382f-42c6-a8eb-da3da4964c2c&source=extension&step=jd`,
    );
  });

  it("adds jd_review when capture may be incomplete", () => {
    const url = buildTailorInFlintApplyUrl("abc", { reviewRecommended: true });
    expect(url).toContain("jd_review=1");
  });
});
