import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHostTab } from "../../src/resolveHostTab.js";
import { resetChromeStore } from "../setup.js";

function mockGetCurrent(tab: chrome.tabs.Tab | undefined): void {
  vi.mocked(chrome.tabs.getCurrent).mockImplementation(((callback?: (t?: chrome.tabs.Tab) => void) => {
    if (callback) {
      callback(tab);
      return;
    }
    return Promise.resolve(tab);
  }) as typeof chrome.tabs.getCurrent);
}

describe("resolveHostTab", () => {
  beforeEach(() => {
    resetChromeStore();
    Object.assign(chrome, {
      tabs: {
        getCurrent: vi.fn(),
        query: vi.fn(),
      },
    });
  });

  it("prefers chrome.tabs.getCurrent when it returns a tab id", async () => {
    mockGetCurrent({ id: 42, url: "https://my.greenhouse.io/jobs/search" } as chrome.tabs.Tab);
    const tab = await resolveHostTab();
    expect(tab?.id).toBe(42);
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it("falls back to active tab query when getCurrent has no id", async () => {
    mockGetCurrent(undefined);
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 7, url: "https://example.com/job" } as chrome.tabs.Tab,
    ]);

    const tab = await resolveHostTab();
    expect(tab?.id).toBe(7);
  });
});
