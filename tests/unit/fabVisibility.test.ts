import { afterEach, describe, expect, it } from "vitest";
import {
  FAB_HIDE_GLOBAL_KEY,
  FAB_HIDE_HOSTS_SESSION_KEY,
  FAB_SNOOZE_UNTIL_KEY,
  getFabHideReason,
  hideFabFor24Hours,
  hideFabOnAllSites,
  hideFabOnSiteForSession,
  restoreFabVisibility,
  shouldShowFab,
} from "../../src/fabVisibility.js";
import { resetChromeStore } from "../setup.js";

describe("fabVisibility", () => {
  afterEach(() => {
    resetChromeStore();
  });

  it("shows the FAB by default", async () => {
    expect(await shouldShowFab("www.linkedin.com")).toBe(true);
    expect(await getFabHideReason("www.linkedin.com")).toBe("none");
  });

  it("hides for the current site for this browser session", async () => {
    await hideFabOnSiteForSession("jobs.lever.co");
    expect(await getFabHideReason("jobs.lever.co")).toBe("site_session");
    expect(await shouldShowFab("jobs.lever.co")).toBe(false);
    expect(await shouldShowFab("www.linkedin.com")).toBe(true);
  });

  it("snoozes globally for 24 hours", async () => {
    await hideFabFor24Hours();
    expect(await getFabHideReason("any.example")).toBe("snooze");
    expect(await shouldShowFab("any.example")).toBe(false);
  });

  it("hides on all sites until restored", async () => {
    await hideFabOnAllSites();
    expect(await getFabHideReason("any.example")).toBe("global");
    await restoreFabVisibility();
    expect(await shouldShowFab("any.example")).toBe(true);
  });

  it("restore clears global, snooze, and per-site session hide", async () => {
    await hideFabOnAllSites();
    await hideFabFor24Hours();
    await hideFabOnSiteForSession("greenhouse.io");
    await restoreFabVisibility("greenhouse.io");
    expect(await getFabHideReason("greenhouse.io")).toBe("none");
    const local = await chrome.storage.local.get([FAB_HIDE_GLOBAL_KEY, FAB_SNOOZE_UNTIL_KEY]);
    expect(local[FAB_HIDE_GLOBAL_KEY]).toBeUndefined();
    expect(local[FAB_SNOOZE_UNTIL_KEY]).toBeUndefined();
    const session = await chrome.storage.session.get(FAB_HIDE_HOSTS_SESSION_KEY);
    expect(session[FAB_HIDE_HOSTS_SESSION_KEY]).toBeUndefined();
  });
});
