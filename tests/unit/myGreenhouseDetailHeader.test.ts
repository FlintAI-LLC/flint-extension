import { beforeEach, describe, expect, it } from "vitest";
import { findVisibleJobHeaderFromDetailPane } from "../../src/myGreenhouseExtract.js";

describe("findVisibleJobHeaderFromDetailPane", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Element.prototype.getBoundingClientRect = function () {
      const el = this as Element;
      if (el.closest(".detail-pane")) {
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
        left: 40,
        width: 280,
        height: 120,
        top: 0,
        right: 320,
        bottom: 120,
        x: 40,
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
  });

  it("reads title and company from detail pane text when headings are not h1-h3", () => {
    const html = `
      <div id="app">
        <div class="list-pane"><p>Other Job</p></div>
        <div class="job-panel">
          <div>Sr Software Engineer</div>
          <div>Mindbody</div>
          <div>Remote</div>
          <div>United States</div>
          <div>Posted · 6 hours ago</div>
          <p>${"Do work that matters. ".repeat(40)}</p>
        </div>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Element.prototype.getBoundingClientRect = function () {
      const el = this as Element;
      if (el.classList.contains("job-panel")) {
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
        left: 40,
        width: 280,
        height: 120,
        top: 0,
        right: 320,
        bottom: 120,
        x: 40,
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

    const header = findVisibleJobHeaderFromDetailPane(doc);
    expect(header?.title).toBe("Sr Software Engineer");
    expect(header?.company).toBe("Mindbody");
  });

  it("reads title and company from the right-hand detail pane", () => {
    const html = `
      <div id="app">
        <div class="list-pane"><h2>Other Job</h2><p>Other Co</p></div>
        <div class="detail-pane">
          <h2>AI Software Engineer</h2>
          <p>Zone &amp; Co</p>
          <p>Remote</p>
          <p>Posted · 1 hour ago</p>
        </div>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const header = findVisibleJobHeaderFromDetailPane(doc);
    expect(header?.title).toBe("AI Software Engineer");
    expect(header?.company).toBe("Zone & Co");
  });
});
