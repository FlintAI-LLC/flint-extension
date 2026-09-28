import { beforeEach, describe, expect, it } from "vitest";
import { writeListClickMyGreenhouseJobContext } from "../../src/myGreenhouseContext.js";
import { waitForMyGreenhouseJobContext } from "../../src/myGreenhouseWait.js";

describe("waitForMyGreenhouseJobContext", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    window.getComputedStyle = () =>
      ({
        display: "block",
        visibility: "visible",
        opacity: "1",
      }) as CSSStyleDeclaration;
  });

  it("waits at least 2.5s before accepting a header-only match", async () => {
    const html = `<div id="app"><div class="job-panel"></div></div>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const panel = doc.querySelector(".job-panel") as HTMLElement;

    Element.prototype.getBoundingClientRect = function () {
      const el = this as Element;
      const inPanel = el.classList.contains("job-panel") || el.closest(".job-panel");
      if (inPanel) {
        return {
          left: 420,
          width: 700,
          height: 800,
          top: 0,
          right: 1120,
          bottom: 800,
          x: 420,
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

    setTimeout(() => {
      panel.innerHTML = `
        <h2>Sr Software Engineer</h2>
        <p>Mindbody</p>
        <p>Remote</p>
        <p>United States</p>
        <p>Posted · 6 hours ago</p>
      `;
    }, 400);

    const result = await waitForMyGreenhouseJobContext(doc, 4000);
    expect(result.ready).toBe(true);
    expect(result.reason).toBe("header");
    expect(result.waitedMs).toBeGreaterThanOrEqual(2500);
  });

  it("resolves immediately when list-click context is present", async () => {
    sessionStorage.clear();
    writeListClickMyGreenhouseJobContext({
      title: "Sr Software Engineer",
      company: "Mindbody",
    });
    const doc = new DOMParser().parseFromString("<div id='app'></div>", "text/html");
    const result = await waitForMyGreenhouseJobContext(doc, 1000);
    expect(result.ready).toBe(true);
    expect(result.reason).toBe("list-click");
    expect(result.waitedMs).toBeLessThan(100);
  });
});
