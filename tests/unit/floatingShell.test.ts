import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloatingShell } from "../../content/floating/shell.js";
import {
  FLOATING_PANEL_EXPANDED_KEY,
  getPanelExpanded,
} from "../../content/floating/panelState.js";
import {
  FLINT_CONTENT_SOURCE,
  FLINT_MYGH_JOB_CHANGED,
} from "../../src/panelMessages.js";
import { resetChromeStore } from "../setup.js";

function clickOutside(): void {
  const outside = document.createElement("button");
  document.body.appendChild(outside);
  outside.click();
  outside.remove();
}

describe("FloatingShell", () => {
  beforeEach(() => {
    resetChromeStore();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts collapsed by default: FAB visible, drawer hidden", () => {
    const shell = new FloatingShell();
    shell.mount();

    const host = document.querySelector("[data-flint-floating-shell]");
    expect(host).not.toBeNull();

    const shadow = (host as HTMLElement).shadowRoot!;
    const fab = shadow.querySelector(".fab") as HTMLButtonElement;
    const drawer = shadow.querySelector(".drawer") as HTMLElement;

    expect(fab.hidden).toBe(false);
    expect(drawer.hidden).toBe(true);
    expect(shell.isExpanded()).toBe(false);
  });

  it("expands the drawer and hides the FAB when the logo is clicked", () => {
    const shell = new FloatingShell();
    shell.mount();

    const host = document.querySelector("[data-flint-floating-shell]") as HTMLElement;
    const shadow = host.shadowRoot!;
    const fab = shadow.querySelector(".fab") as HTMLButtonElement;
    const drawer = shadow.querySelector(".drawer") as HTMLElement;

    fab.click();

    expect(shell.isExpanded()).toBe(true);
    expect(drawer.hidden).toBe(false);
    expect(fab.hidden).toBe(true);
  });

  it("loads the popup UI in an extension-origin iframe", () => {
    const shell = new FloatingShell();
    shell.mount();

    const host = document.querySelector("[data-flint-floating-shell]") as HTMLElement;
    const frame = host.shadowRoot!.querySelector(".drawer-frame") as HTMLIFrameElement;

    expect(frame.src).toBe("chrome-extension://fake-id/popup/index.html");
  });

  it("does not reload the popup iframe when reopening the same job", () => {
    const shell = new FloatingShell();
    shell.mount();
    shell.expand();

    const host = document.querySelector("[data-flint-floating-shell]") as HTMLElement;
    const frame = host.shadowRoot!.querySelector(".drawer-frame") as HTMLIFrameElement;
    const srcAfterFirstExpand = frame.src;

    shell.collapse();
    shell.expand();

    expect(frame.src).toBe(srcAfterFirstExpand);
  });

  it("reloads the popup iframe after MyGreenhouse job selection changes", () => {
    const shell = new FloatingShell();
    shell.mount();
    shell.expand();

    const host = document.querySelector("[data-flint-floating-shell]") as HTMLElement;
    const frame = host.shadowRoot!.querySelector(".drawer-frame") as HTMLIFrameElement;
    const srcBeforeJobChange = frame.src;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: FLINT_MYGH_JOB_CHANGED,
          source: FLINT_CONTENT_SOURCE,
          key: "Engineer\u0000Acme",
        },
        source: window,
      }),
    );
    shell.expand();

    expect(frame.src).not.toBe(srcBeforeJobChange);
    expect(frame.src).toContain("flint=");
  });

  it("collapses on outside click but not on clicks inside the drawer", () => {
    const shell = new FloatingShell();
    shell.mount();
    shell.expand();

    const host = document.querySelector("[data-flint-floating-shell]") as HTMLElement;
    const shadow = host.shadowRoot!;
    const drawer = shadow.querySelector(".drawer") as HTMLElement;
    const title = shadow.querySelector(".drawer-title") as HTMLElement;

    title.click();
    expect(shell.isExpanded()).toBe(true);
    expect(drawer.hidden).toBe(false);

    clickOutside();
    expect(shell.isExpanded()).toBe(false);
    expect(drawer.hidden).toBe(true);
  });

  it("collapses on Escape while expanded, and ignores Escape while collapsed", () => {
    const shell = new FloatingShell();
    shell.mount();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(shell.isExpanded()).toBe(false);

    shell.expand();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(shell.isExpanded()).toBe(false);
  });

  it("closes via the drawer close button", () => {
    const shell = new FloatingShell();
    shell.mount();
    shell.expand();

    const host = document.querySelector("[data-flint-floating-shell]") as HTMLElement;
    const closeButton = host.shadowRoot!.querySelector(".drawer-close") as HTMLButtonElement;
    closeButton.click();

    expect(shell.isExpanded()).toBe(false);
  });

  it("toggle() flips between expanded and collapsed", () => {
    const shell = new FloatingShell();
    shell.mount();

    shell.toggle();
    expect(shell.isExpanded()).toBe(true);
    shell.toggle();
    expect(shell.isExpanded()).toBe(false);
  });

  it("persists expand/collapse state via chrome.storage", async () => {
    const shell = new FloatingShell();
    shell.mount();

    shell.expand();
    await Promise.resolve();
    expect(await getPanelExpanded()).toBe(true);

    shell.collapse();
    await Promise.resolve();
    expect(await getPanelExpanded()).toBe(false);
  });

  it("restorePersistedState re-expands a session that was left open", async () => {
    const priorShell = new FloatingShell();
    priorShell.mount();
    priorShell.expand();
    await Promise.resolve();
    priorShell.destroy();
    document.body.innerHTML = "";

    const shell = new FloatingShell();
    shell.mount();
    expect(shell.isExpanded()).toBe(false);

    await shell.restorePersistedState();
    expect(shell.isExpanded()).toBe(true);
  });

  it("reuses an existing mounted host instead of creating a duplicate", () => {
    const first = new FloatingShell();
    first.mount();

    const second = new FloatingShell();
    second.mount();

    expect(document.querySelectorAll("[data-flint-floating-shell]")).toHaveLength(1);

    second.expand();
    const host = document.querySelector("[data-flint-floating-shell]") as HTMLElement;
    const drawer = host.shadowRoot!.querySelector(".drawer") as HTMLElement;
    expect(drawer.hidden).toBe(false);
  });

  it("destroy() removes the host and stops listening for outside clicks", () => {
    const shell = new FloatingShell();
    shell.mount();
    shell.expand();
    shell.destroy();

    expect(document.querySelector("[data-flint-floating-shell]")).toBeNull();
    expect(shell.isExpanded()).toBe(false);
  });

  it("collapses when the drawer iframe posts FLINT_FLOATING_COLLAPSE", () => {
    const shell = new FloatingShell();
    shell.mount();
    shell.expand();

    const host = document.querySelector("[data-flint-floating-shell]") as HTMLElement;
    const frame = host.shadowRoot!.querySelector(".drawer-frame") as HTMLIFrameElement;
    Object.defineProperty(frame, "contentWindow", {
      value: window,
      configurable: true,
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "FLINT_FLOATING_COLLAPSE" },
        source: window,
      }),
    );

    expect(shell.isExpanded()).toBe(false);
  });

  it("collapses the drawer when MyGreenhouse job selection changes", () => {
    const shell = new FloatingShell();
    shell.mount();
    shell.expand();
    expect(shell.isExpanded()).toBe(true);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: FLINT_MYGH_JOB_CHANGED,
          source: FLINT_CONTENT_SOURCE,
          key: "Engineer\u0000Acme",
        },
        source: window,
      }),
    );

    expect(shell.isExpanded()).toBe(false);
  });

  it("restorePersistedState reloads the popup iframe for fresh extraction", async () => {
    const shell = new FloatingShell();
    shell.mount();

    const host = document.querySelector("[data-flint-floating-shell]") as HTMLElement;
    const frame = host.shadowRoot!.querySelector(".drawer-frame") as HTMLIFrameElement;
    const initialSrc = frame.src;

    await chrome.storage.session.set({ [FLOATING_PANEL_EXPANDED_KEY]: true });
    await shell.restorePersistedState();

    expect(shell.isExpanded()).toBe(true);
    expect(frame.src).not.toBe(initialSrc);
    expect(frame.src).toContain("flint=");
  });

  it("does not stack document listeners across two FloatingShell instances", () => {
    const clickSpy = vi.spyOn(document, "addEventListener");
    const first = new FloatingShell();
    first.mount();
    const clickCallsAfterFirst = clickSpy.mock.calls.filter(
      (call) => call[0] === "click" && call[2] === true,
    ).length;

    const second = new FloatingShell();
    second.mount();
    const clickCallsAfterSecond = clickSpy.mock.calls.filter(
      (call) => call[0] === "click" && call[2] === true,
    ).length;

    expect(clickCallsAfterSecond).toBe(clickCallsAfterFirst);
    clickSpy.mockRestore();
  });
});
