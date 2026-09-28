import { beforeEach, describe, expect, it } from "vitest";
import {
  findMyGreenhouseUiMountRoot,
  reparentAllFlintUiHosts,
  reparentFlintUiHost,
} from "../../src/myGreenhouseUiMount.js";

function mockFlexLayoutRects(): void {
  Element.prototype.getBoundingClientRect = function () {
    const el = this as Element;
    if (el.classList.contains("job-panel")) {
      return {
        left: 360,
        width: 700,
        height: 900,
        top: 0,
        right: 1060,
        bottom: 900,
        x: 360,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return {
      left: 0,
      width: 1200,
      height: 900,
      top: 0,
      right: 1200,
      bottom: 900,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
  window.getComputedStyle = () =>
    ({
      display: "block",
      visibility: "visible",
      opacity: "1",
    }) as CSSStyleDeclaration;
}

describe("myGreenhouseUiMount", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname: "my.greenhouse.io", href: "https://my.greenhouse.io/jobs/search" },
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    mockFlexLayoutRects();
  });

  it("reparents Flint UI hosts into the right-hand detail pane", () => {
    document.body.innerHTML = `
      <div id="app">
        <main class="job-panel">
          <h2>Senior Engineer</h2>
          <p>Acme Corp</p>
          <p>${"Job description text. ".repeat(40)}</p>
          <form><input name="job_application[email]" /></form>
        </main>
      </div>
    `;

    const overlay = document.createElement("div");
    overlay.setAttribute("data-flint-autofill-overlay", "true");
    document.body.appendChild(overlay);

    const root = findMyGreenhouseUiMountRoot();
    expect(root).not.toBeNull();
    expect(reparentFlintUiHost(overlay)).toBe(true);
    expect(overlay.parentElement).toBe(root);
    expect(overlay.dataset.insideMyGreenhousePanel).toBe("1");

    reparentAllFlintUiHosts();
    expect(overlay.parentElement).toBe(root);
  });
});
