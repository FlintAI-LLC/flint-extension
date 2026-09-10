import { describe, it, expect } from "vitest";
import {
  buildExtensionOAuthRedirectUri,
  buildTailorInFlintApplyUrl,
  getWebAppBaseUrl,
} from "../../src/urls.js";

describe("buildExtensionOAuthRedirectUri", () => {
  it("uses a dedicated callback path separate from NextAuth", () => {
    const base = getWebAppBaseUrl().replace(/\/$/, "");
    expect(buildExtensionOAuthRedirectUri()).toBe(
      `${base}/auth/extension/google/callback`,
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
