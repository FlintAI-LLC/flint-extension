import { describe, expect, it } from "vitest";
import {
  isExtensionContextInvalidatedError,
  isExtensionContextValid,
} from "../../src/extensionContext.js";

describe("extensionContext", () => {
  it("detects invalidated extension errors", () => {
    expect(isExtensionContextInvalidatedError(new Error("Extension context invalidated."))).toBe(
      true,
    );
    expect(isExtensionContextInvalidatedError(new Error("network"))).toBe(false);
  });

  it("reports a valid chrome runtime in tests", () => {
    expect(isExtensionContextValid()).toBe(true);
  });
});
