import { describe, expect, it, vi } from "vitest";
import {
  installFlintUiClickGuard,
  isolateExtensionUiClicks,
} from "../../src/extensionClickIsolation.js";

describe("isolateExtensionUiClicks", () => {
  it("stops click propagation from the extension host on bubble", () => {
    const host = document.createElement("div");
    host.setAttribute("data-flint-autofill-overlay", "true");
    document.body.appendChild(host);
    isolateExtensionUiClicks(host);

    const outer = vi.fn();
    document.body.addEventListener("click", outer, false);

    host.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(outer).not.toHaveBeenCalled();
    host.remove();
  });

  it("installFlintUiClickGuard blocks document bubble handlers for Flint UI", () => {
    installFlintUiClickGuard();
    const host = document.createElement("div");
    host.setAttribute("data-flint-floating-shell", "true");
    document.body.appendChild(host);

    const outer = vi.fn();
    document.addEventListener("click", outer, false);

    host.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

    expect(outer).not.toHaveBeenCalled();
    host.remove();
  });

  it("installFlintUiClickGuard does not block listeners on the Flint target", () => {
    installFlintUiClickGuard();
    const host = document.createElement("div");
    host.setAttribute("data-flint-floating-shell", "true");
    document.body.appendChild(host);

    const inner = vi.fn();
    host.addEventListener("click", inner, false);
    host.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(inner).toHaveBeenCalled();
    host.remove();
  });

  it("only registers listeners once per host", () => {
    const host = document.createElement("div");
    const spy = vi.spyOn(host, "addEventListener");

    isolateExtensionUiClicks(host);
    isolateExtensionUiClicks(host);

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    const callsAfterFirst = spy.mock.calls.length;
    isolateExtensionUiClicks(host);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });
});
