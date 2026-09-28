import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeStore, dispatchMessage } from "../setup.js";
import * as authModule from "../../src/auth.js";
// Side-effect import: registers chrome.runtime.onMessage / chrome.alarms /
// chrome.action listeners at module top level, exactly like a real SW boot.
import "../../background/service-worker.js";

beforeEach(() => {
  resetChromeStore();
  vi.restoreAllMocks();
});

describe("service-worker OAUTH_LOGIN handler — must-fix 1 regression", () => {
  it(
    "writes sr_oauth_error to chrome.storage.local when github OAuth fails " +
      "on a simulated Chrome (non-Firefox chrome.runtime.getURL)",
    async () => {
      // tests/setup.ts's chrome.runtime.getURL returns chrome-extension://,
      // i.e. this simulates Chrome, not Firefox.
      vi.spyOn(authModule, "loginWithProvider").mockRejectedValue(
        new Error("redirect_uri_mismatch"),
      );

      const pendingResponse = await new Promise<unknown>((resolve) => {
        dispatchMessage({ type: "OAUTH_LOGIN", provider: "github" }, resolve);
      });

      // Must-fix 1 part A: github takes the synchronous { pending: true }
      // response path on EVERY browser (not just Firefox), because
      // github/microsoft always use the tab-capture flow that can destroy
      // the popup that sent this message.
      expect(pendingResponse).toEqual({
        success: false,
        error: "",
        provider: "github",
        pending: true,
      });

      // Let the rejected loginWithProvider promise's .catch() handler run.
      await new Promise((r) => setTimeout(r, 0));

      const stored = await chrome.storage.local.get("sr_oauth_error");
      expect(typeof stored.sr_oauth_error).toBe("string");
      expect(stored.sr_oauth_error).toBe("redirect_uri_mismatch");
    },
  );

  it("does NOT write sr_oauth_error when github OAuth succeeds", async () => {
    vi.spyOn(authModule, "loginWithProvider").mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      display_name: "A",
    });

    await new Promise<unknown>((resolve) => {
      dispatchMessage({ type: "OAUTH_LOGIN", provider: "github" }, resolve);
    });
    await new Promise((r) => setTimeout(r, 0));

    const stored = await chrome.storage.local.get("sr_oauth_error");
    expect(stored.sr_oauth_error).toBeUndefined();
  });
});
