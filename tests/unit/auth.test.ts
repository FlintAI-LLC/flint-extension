import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeStore } from "../setup.js";
import {
  login,
  logout,
  getAccessTokenOrNull,
  refreshIfNeeded,
  ensureRefreshAlarmRegistered,
  loginWithProvider,
} from "../../src/auth.js";
import * as api from "../../src/api.js";
import * as oauthTab from "../../src/oauthTab.js";
import * as storage from "../../src/storage.js";
import { buildExtensionOAuthRedirectUri } from "../../src/urls.js";

const MOCK_USER = { id: "u1", email: "a@b.com", display_name: "A" };

function mockLoginResponse(overrides: Partial<ReturnType<typeof api.apiLogin> extends Promise<infer T> ? T : never> = {}) {
  return {
    access_token: "tok_access",
    refresh_token: "tok_refresh",
    expires_in: 900,
    user: MOCK_USER,
    ...overrides,
  };
}

beforeEach(() => {
  resetChromeStore();
  vi.restoreAllMocks();
});

describe("login()", () => {
  it("stores tokens and registers the refresh alarm", async () => {
    vi.spyOn(api, "apiLogin").mockResolvedValue(mockLoginResponse());

    const user = await login("a@b.com", "password123");

    expect(user).toEqual(MOCK_USER);

    const stored = await storage.getAccessToken();
    expect(stored).toBe("tok_access");

    const alarm = await chrome.alarms.get("token-refresh");
    expect(alarm).toBeDefined();
    expect(alarm?.name).toBe("token-refresh");
  });
});

describe("logout()", () => {
  it("clears storage and cancels the alarm", async () => {
    vi.spyOn(api, "apiLogin").mockResolvedValue(mockLoginResponse());
    await login("a@b.com", "pw");

    await logout();

    const token = await storage.getAccessToken();
    expect(token).toBeNull();

    const alarm = await chrome.alarms.get("token-refresh");
    expect(alarm).toBeUndefined();
  });
});

describe("getAccessTokenOrNull()", () => {
  it("returns null when not logged in", async () => {
    const token = await getAccessTokenOrNull();
    expect(token).toBeNull();
  });

  it("returns the access token when not expired", async () => {
    vi.spyOn(api, "apiLogin").mockResolvedValue(mockLoginResponse());
    await login("a@b.com", "pw");

    const token = await getAccessTokenOrNull();
    expect(token).toBe("tok_access");
  });
});

describe("refreshIfNeeded()", () => {
  it("refreshes when token is within expiry buffer", async () => {
    // Set an already-expired expires_at.
    await storage.saveAuth("old_access", "old_refresh", -1, MOCK_USER);

    vi.spyOn(api, "apiRefresh").mockResolvedValue(
      mockLoginResponse({ access_token: "new_access", refresh_token: "new_refresh" }),
    );

    await refreshIfNeeded();

    const token = await storage.getAccessToken();
    expect(token).toBe("new_access");
  });

  it("clears auth when refresh fails", async () => {
    await storage.saveAuth("old_access", "old_refresh", -1, MOCK_USER);

    vi.spyOn(api, "apiRefresh").mockRejectedValue(new Error("401"));

    await refreshIfNeeded();

    const token = await storage.getAccessToken();
    expect(token).toBeNull();
  });

  it("does not propagate when clearAuth itself fails after a refresh error", async () => {
    // Regression: a chrome.storage.local.remove failure inside _doRefresh
    // must not surface as an unhandled rejection back to the alarm handler.
    await storage.saveAuth("old_access", "old_refresh", -1, MOCK_USER);

    vi.spyOn(api, "apiRefresh").mockRejectedValue(new Error("network"));
    vi.spyOn(storage, "clearAuth").mockRejectedValue(new Error("storage gone"));

    await expect(refreshIfNeeded()).resolves.toBeUndefined();
  });
});

describe("loginWithProvider() — github/microsoft always use the tab flow", () => {
  // tests/setup.ts's chrome mock DOES expose chrome.identity now (see the
  // must-fix-3 regression block below), so this suite proves the real
  // invariant: useChromeIdentity is false for github/microsoft because of
  // the `provider === "google"` gate in src/auth.ts, not because identity is
  // missing from the mock. github/microsoft dispatch to
  // waitForOAuthCodeInTab (never chrome.identity.launchWebAuthFlow) and call
  // apiOAuthCallback with the correct provider + redirect_uri.

  it("github: builds the github authorize URL, tab-captures the code, and posts provider=github", async () => {
    const tabSpy = vi
      .spyOn(oauthTab, "waitForOAuthCodeInTab")
      .mockResolvedValue("github-code-123");
    const callbackSpy = vi
      .spyOn(api, "apiOAuthCallback")
      .mockResolvedValue(mockLoginResponse());

    const user = await loginWithProvider("github");

    expect(user).toEqual(MOCK_USER);
    expect(tabSpy).toHaveBeenCalledTimes(1);
    const [authUrl, redirectUri, providerLabel] = tabSpy.mock.calls[0];
    expect(authUrl).toContain("https://github.com/login/oauth/authorize");
    expect(redirectUri).toBe(buildExtensionOAuthRedirectUri("github"));
    expect(providerLabel).toBe("GitHub");

    expect(callbackSpy).toHaveBeenCalledWith(
      "github",
      "github-code-123",
      buildExtensionOAuthRedirectUri("github"),
    );
  });

  it("microsoft: builds the Microsoft authorize URL, tab-captures the code, and posts provider=microsoft", async () => {
    const tabSpy = vi
      .spyOn(oauthTab, "waitForOAuthCodeInTab")
      .mockResolvedValue("ms-code-456");
    const callbackSpy = vi
      .spyOn(api, "apiOAuthCallback")
      .mockResolvedValue(mockLoginResponse());

    const user = await loginWithProvider("microsoft");

    expect(user).toEqual(MOCK_USER);
    const [authUrl, redirectUri, providerLabel] = tabSpy.mock.calls[0];
    expect(authUrl).toContain(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(redirectUri).toBe(buildExtensionOAuthRedirectUri("microsoft"));
    expect(providerLabel).toBe("Microsoft");

    expect(callbackSpy).toHaveBeenCalledWith(
      "microsoft",
      "ms-code-456",
      buildExtensionOAuthRedirectUri("microsoft"),
    );
  });

  it("stores tokens and registers the refresh alarm on success, like the google path", async () => {
    vi.spyOn(oauthTab, "waitForOAuthCodeInTab").mockResolvedValue("github-code");
    vi.spyOn(api, "apiOAuthCallback").mockResolvedValue(mockLoginResponse());

    await loginWithProvider("github");

    const stored = await storage.getAccessToken();
    expect(stored).toBe("tok_access");
    const alarm = await chrome.alarms.get("token-refresh");
    expect(alarm).toBeDefined();
  });
});

describe("loginWithProvider() — chrome.identity gating (must-fix 3 regression)", () => {
  // This is the single most important invariant in the whole SSO feature:
  // GitHub and Microsoft must NEVER call chrome.identity.launchWebAuthFlow,
  // only Google may (and only on Chrome). tests/setup.ts now provides a real
  // chrome.identity mock so these assertions can actually fail if the
  // `provider === "google"` gate in src/auth.ts's useChromeIdentity is ever
  // removed or narrowed.

  it("google on a simulated Chrome DOES call chrome.identity.launchWebAuthFlow", async () => {
    const launchSpy = vi
      .spyOn(chrome.identity, "launchWebAuthFlow")
      .mockImplementation(
        (
          (
            _details: chrome.identity.WebAuthFlowOptions,
            callback: (responseUrl?: string) => void,
          ) => {
            callback("https://fakeextensionid.chromiumapp.org/?code=google-code-abc");
          }
        ) as typeof chrome.identity.launchWebAuthFlow,
      );
    vi.spyOn(api, "apiOAuthCallback").mockResolvedValue(mockLoginResponse());

    const user = await loginWithProvider("google");

    expect(user).toEqual(MOCK_USER);
    expect(launchSpy).toHaveBeenCalledTimes(1);
  });

  it("github NEVER calls chrome.identity.launchWebAuthFlow (tab flow only)", async () => {
    const launchSpy = vi.spyOn(chrome.identity, "launchWebAuthFlow");
    vi.spyOn(oauthTab, "waitForOAuthCodeInTab").mockResolvedValue("github-code");
    vi.spyOn(api, "apiOAuthCallback").mockResolvedValue(mockLoginResponse());

    const user = await loginWithProvider("github");

    expect(user).toEqual(MOCK_USER);
    expect(launchSpy).not.toHaveBeenCalled();
  });

  it("microsoft NEVER calls chrome.identity.launchWebAuthFlow (tab flow only)", async () => {
    const launchSpy = vi.spyOn(chrome.identity, "launchWebAuthFlow");
    vi.spyOn(oauthTab, "waitForOAuthCodeInTab").mockResolvedValue("ms-code");
    vi.spyOn(api, "apiOAuthCallback").mockResolvedValue(mockLoginResponse());

    const user = await loginWithProvider("microsoft");

    expect(user).toEqual(MOCK_USER);
    expect(launchSpy).not.toHaveBeenCalled();
  });
});

describe("ensureRefreshAlarmRegistered()", () => {
  it("registers alarm when a refresh token is stored", async () => {
    await storage.saveAuth("access", "refresh", 900, MOCK_USER);

    await ensureRefreshAlarmRegistered();

    const alarm = await chrome.alarms.get("token-refresh");
    expect(alarm).toBeDefined();
  });

  it("does not register alarm when no refresh token exists", async () => {
    await ensureRefreshAlarmRegistered();

    const alarm = await chrome.alarms.get("token-refresh");
    expect(alarm).toBeUndefined();
  });
});
