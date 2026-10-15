import { describe, expect, it } from "vitest";
import { isFlintApplyApplyIntent } from "../../src/applyIntent.js";

describe("isFlintApplyApplyIntent", () => {
  it("returns true when flintapply=apply is present", () => {
    expect(
      isFlintApplyApplyIntent("https://boards.greenhouse.io/acme/jobs/1?flintapply=apply"),
    ).toBe(true);
  });

  it("returns false for normal job URLs", () => {
    expect(isFlintApplyApplyIntent("https://boards.greenhouse.io/acme/jobs/1")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isFlintApplyApplyIntent(undefined)).toBe(false);
    expect(isFlintApplyApplyIntent("not-a-url")).toBe(false);
  });
});
