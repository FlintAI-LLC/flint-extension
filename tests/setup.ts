// Minimal chrome extension API stub for unit tests.
// Only surfaces the APIs exercised in src/auth.ts and src/storage.ts.

import { vi } from "vitest";

const _store: Record<string, unknown> = {};
const _sessionStore: Record<string, unknown> = {};
const _alarms: Record<string, chrome.alarms.Alarm> = {};
const _messageListeners: Array<
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => boolean | undefined | void
> = [];

const chromeMock: Partial<typeof chrome> = {
  storage: {
    local: {
      get: (keys: string | string[] | Record<string, unknown> | null) => {
        const keyList = Array.isArray(keys)
          ? keys
          : typeof keys === "string"
            ? [keys]
            : keys !== null
              ? Object.keys(keys)
              : Object.keys(_store);
        const result: Record<string, unknown> = {};
        for (const k of keyList) result[k] = _store[k];
        return Promise.resolve(result);
      },
      set: (items: Record<string, unknown>) => {
        Object.assign(_store, items);
        return Promise.resolve();
      },
      remove: (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete _store[k];
        return Promise.resolve();
      },
      clear: () => {
        Object.keys(_store).forEach((k) => delete _store[k]);
        return Promise.resolve();
      },
    },
    session: {
      get: (keys: string | string[] | Record<string, unknown> | null) => {
        const keyList = Array.isArray(keys)
          ? keys
          : typeof keys === "string"
            ? [keys]
            : keys !== null
              ? Object.keys(keys)
              : Object.keys(_sessionStore);
        const result: Record<string, unknown> = {};
        for (const k of keyList) result[k] = _sessionStore[k];
        return Promise.resolve(result);
      },
      set: (items: Record<string, unknown>) => {
        Object.assign(_sessionStore, items);
        return Promise.resolve();
      },
      remove: (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete _sessionStore[k];
        return Promise.resolve();
      },
      clear: () => {
        Object.keys(_sessionStore).forEach((k) => delete _sessionStore[k]);
        return Promise.resolve();
      },
    },
  } as unknown as typeof chrome.storage,

  alarms: {
    create: (name: string, info: chrome.alarms.AlarmCreateInfo) => {
      _alarms[name] = {
        name,
        scheduledTime: Date.now() + (info.delayInMinutes ?? 0) * 60_000,
        periodInMinutes: info.periodInMinutes,
      } as chrome.alarms.Alarm;
    },
    clear: (name: string) => {
      delete _alarms[name];
      return Promise.resolve(true);
    },
    get: (name: string) => Promise.resolve(_alarms[name] ?? undefined),
    onAlarm: {
      addListener: () => undefined,
      removeListener: () => undefined,
      hasListener: () => false,
    } as unknown as chrome.events.Event<(alarm: chrome.alarms.Alarm) => void>,
  } as unknown as typeof chrome.alarms,

  runtime: {
    onMessage: {
      addListener: (
        cb: (
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | undefined | void,
      ) => {
        _messageListeners.push(cb);
      },
      removeListener: () => undefined,
      hasListener: () => false,
    } as unknown as chrome.events.Event<
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => boolean | undefined | void
    >,
    lastError: undefined,
    getURL: (path: string) => `chrome-extension://fake-id/${path}`,
  } as unknown as typeof chrome.runtime,

  // Regression guard for the locked architecture invariant: "GitHub and
  // Microsoft must NEVER call chrome.identity, only Google may" (see
  // src/auth.ts's useChromeIdentity gate). Before this mock existed, the
  // chrome mock had no identity surface at all, so useChromeIdentity was
  // always false in tests regardless of provider — deleting the
  // `provider === "google" &&` guard in src/auth.ts would not have failed a
  // single test. getRedirectURL/launchWebAuthFlow are real vi.fn()s so
  // tests can assert on call counts (see tests/unit/auth.test.ts).
  identity: {
    getRedirectURL: vi.fn(() => "https://fakeextensionid.chromiumapp.org/"),
    launchWebAuthFlow: vi.fn(),
  } as unknown as typeof chrome.identity,

  // Minimal stub so importing background/service-worker.ts (which calls
  // chrome.action.onClicked.addListener at module top level) does not throw
  // in tests.
  action: {
    onClicked: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: () => false,
    } as unknown as chrome.events.Event<(tab: chrome.tabs.Tab) => void>,
  } as unknown as typeof chrome.action,
};

Object.defineProperty(globalThis, "chrome", {
  value: chromeMock,
  writable: true,
  configurable: true,
});

// Helper for tests to simulate sending a chrome message.
export function dispatchMessage(
  message: unknown,
  sendResponse: (response?: unknown) => void = () => undefined,
): void {
  for (const listener of _messageListeners) {
    listener(
      message,
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
  }
}

export function resetChromeStore(): void {
  Object.keys(_store).forEach((k) => delete _store[k]);
  Object.keys(_sessionStore).forEach((k) => delete _sessionStore[k]);
  Object.keys(_alarms).forEach((k) => delete _alarms[k]);
}
