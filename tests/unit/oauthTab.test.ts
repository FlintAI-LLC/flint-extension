import { describe, it, expect, beforeEach, vi } from "vitest";
import { waitForOAuthCodeInTab } from "../../src/oauthTab.js";
import { buildExtensionOAuthRedirectUri } from "../../src/urls.js";

const REDIRECT_URI = buildExtensionOAuthRedirectUri("google");

type TabListener = (
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
) => void;

type RemovedListener = (tabId: number) => void;

type WebNavigationListener = (
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
) => void;

let tabUpdatedListeners: TabListener[] = [];
let tabRemovedListeners: RemovedListener[] = [];
let webNavigationListeners: WebNavigationListener[] = [];
let createdTabId = 1;

function installTabsMock(): void {
  tabUpdatedListeners = [];
  tabRemovedListeners = [];
  webNavigationListeners = [];
  createdTabId = 1;

  const tabsMock = {
    create: (
      _createProperties: chrome.tabs.CreateProperties,
      callback?: (tab: chrome.tabs.Tab) => void,
    ) => {
      const tab = { id: createdTabId++ } as chrome.tabs.Tab;
      callback?.(tab);
    },
    remove: vi.fn((_tabId: number) => Promise.resolve()),
    onUpdated: {
      addListener: (cb: TabListener) => {
        tabUpdatedListeners.push(cb);
      },
      removeListener: (cb: TabListener) => {
        tabUpdatedListeners = tabUpdatedListeners.filter((l) => l !== cb);
      },
    },
    onRemoved: {
      addListener: (cb: RemovedListener) => {
        tabRemovedListeners.push(cb);
      },
      removeListener: (cb: RemovedListener) => {
        tabRemovedListeners = tabRemovedListeners.filter((l) => l !== cb);
      },
    },
  };

  const webNavigationMock = {
    onCommitted: {
      addListener: (cb: WebNavigationListener) => {
        webNavigationListeners.push(cb);
      },
      removeListener: (cb: WebNavigationListener) => {
        webNavigationListeners = webNavigationListeners.filter((l) => l !== cb);
      },
    },
  };

  Object.assign(chrome, { tabs: tabsMock, webNavigation: webNavigationMock });
}

function emitTabRedirect(
  tabId: number,
  url: string,
): void {
  for (const listener of tabUpdatedListeners) {
    listener(tabId, { url, status: "loading" }, { id: tabId, url } as chrome.tabs.Tab);
  }
  for (const listener of webNavigationListeners) {
    listener({ tabId, url } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
  }
}

beforeEach(() => {
  installTabsMock();
});

describe("waitForOAuthCodeInTab", () => {
  it("resolves the authorization code from the redirect URL", async () => {
    const promise = waitForOAuthCodeInTab(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
      REDIRECT_URI,
    );

    emitTabRedirect(
      1,
      `${REDIRECT_URI}?code=auth-code-123&scope=email`,
    );

    await expect(promise).resolves.toBe("auth-code-123");
    expect(chrome.tabs.remove).toHaveBeenCalledWith(1);
  });

  it("rejects when the user closes the sign-in tab", async () => {
    const promise = waitForOAuthCodeInTab(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
      REDIRECT_URI,
    );

    for (const listener of tabRemovedListeners) {
      listener(1);
    }

    await expect(promise).rejects.toThrow("OAuth cancelled");
  });

  it("rejects Google error responses", async () => {
    const promise = waitForOAuthCodeInTab(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
      REDIRECT_URI,
    );

    emitTabRedirect(
      1,
      `${REDIRECT_URI}?error=access_denied&error_description=User%20denied`,
    );

    await expect(promise).rejects.toThrow("User denied");
  });

  it("uses the default 'Google' label when no error_description is present", async () => {
    const promise = waitForOAuthCodeInTab(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
      REDIRECT_URI,
    );

    emitTabRedirect(1, `${REDIRECT_URI}?error=access_denied`);

    await expect(promise).rejects.toThrow("Google sign-in failed (access_denied)");
  });

  it("interpolates a provided providerLabel into the no-code error message", async () => {
    const githubRedirectUri = buildExtensionOAuthRedirectUri("github");
    const promise = waitForOAuthCodeInTab(
      "https://github.com/login/oauth/authorize?client_id=x",
      githubRedirectUri,
      "GitHub",
    );

    emitTabRedirect(1, `${githubRedirectUri}?state=abc`);

    await expect(promise).rejects.toThrow("No authorization code returned from GitHub");
  });

  it("interpolates a provided providerLabel into the generic error message", async () => {
    const msRedirectUri = buildExtensionOAuthRedirectUri("microsoft");
    const promise = waitForOAuthCodeInTab(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x",
      msRedirectUri,
      "Microsoft",
    );

    emitTabRedirect(1, `${msRedirectUri}?error=access_denied`);

    await expect(promise).rejects.toThrow("Microsoft sign-in failed (access_denied)");
  });
});
