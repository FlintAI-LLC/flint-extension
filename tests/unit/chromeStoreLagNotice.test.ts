import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  RECOMMENDED_DEV_BUILD_VERSION,
  shouldShowChromeStoreLagNotice,
} from "../../src/chromeStoreLagNotice.js";

describe("shouldShowChromeStoreLagNotice", () => {
  it("nudges store builds below the recommended dev zip", () => {
    assert.equal(shouldShowChromeStoreLagNotice("0.1.35"), true);
    assert.equal(shouldShowChromeStoreLagNotice("0.1.40"), true);
  });

  it("hides nudge at or above recommended dev build", () => {
    assert.equal(shouldShowChromeStoreLagNotice(RECOMMENDED_DEV_BUILD_VERSION), false);
    assert.equal(shouldShowChromeStoreLagNotice("0.1.42"), false);
  });
});
