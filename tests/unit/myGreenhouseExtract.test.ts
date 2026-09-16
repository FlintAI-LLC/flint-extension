import { beforeEach, describe, expect, it } from "vitest";
import {
  extractMyGreenhouseFromDocument,
  extractTitleCompanyFromPanel,
  findMyGreenhouseDetailPanel,
  findSelectedJobListItem,
  isMyGreenhouseBrandName,
  isMyGreenhouseHost,
  looksLikeListCardPreview,
  parseMyGreenhouseJobText,
  sanitizeMyGreenhouseExtractedFields,
} from "../../src/myGreenhouseExtract.js";
import { isMyGreenhouseAggregatorNoise } from "../../src/jdParse.js";

const TAKEALOT_CARD = `iOS Software Engineer
Takealot Group
Remote
Cape Town, WC
Posted · 2 days ago`;

const MINDBODY_CARD = `Sr Software Engineer
Mindbody
Remote
United States
Posted · 5 hours ago`;

const MINDBODY_BODY = `
Do work that matters.

At Mindbody we help wellness businesses grow. Who you are: you thrive in collaborative
engineering environments. What you get to do every day: build platform APIs in Python
and React. What you bring to the role: 6+ years of experience building scalable web
applications with strong communication skills and AWS experience required.
`;

function mockFlexLayoutRects(): void {
  Element.prototype.getBoundingClientRect = function () {
    const el = this as Element;
    if (el.classList.contains("job-list-item")) {
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
    }
    if (el.className === "job-panel") {
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

describe("myGreenhouseExtract", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    mockFlexLayoutRects();
  });

  it("detects my.greenhouse.io host", () => {
    expect(isMyGreenhouseHost("my.greenhouse.io")).toBe(true);
    expect(isMyGreenhouseHost("boards.greenhouse.io")).toBe(false);
  });

  it("rejects MyGreenhouse branding as company/title", () => {
    expect(isMyGreenhouseBrandName("MyGreenhouse")).toBe(true);
    expect(sanitizeMyGreenhouseExtractedFields("MyGreenhouse", "MyGreenhouse")).toEqual({
      title: "",
      company: "",
    });
  });

  it("treats short list-row previews differently from detail panes", () => {
    expect(looksLikeListCardPreview(TAKEALOT_CARD)).toBe(true);
    expect(looksLikeListCardPreview(`${MINDBODY_CARD}${MINDBODY_BODY}`)).toBe(false);
  });

  it("reads the selected list row, not the first row", () => {
    const html = `
      <div id="app">
        <div class="job-list-item">${TAKEALOT_CARD}</div>
        <div class="job-list-item selected" aria-selected="true">${MINDBODY_CARD}</div>
        <div class="job-panel">
          <h2>Sr Software Engineer</h2>
          <p>Mindbody</p>
          <p>Remote</p>
          <p>United States</p>
          <p>Posted · 5 hours ago</p>
          ${MINDBODY_BODY}
        </div>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");

    const selected = findSelectedJobListItem(doc);
    expect(selected?.title).toContain("Software Engineer");
    expect(selected?.company).toBe("Mindbody");

    const parsed = extractMyGreenhouseFromDocument(doc);
    expect(parsed?.company).toBe("Mindbody");
    expect(parsed?.title).toContain("Software Engineer");
    expect(parsed?.text).toContain("At Mindbody we help wellness businesses grow");
    expect(parsed?.text).not.toContain("Takealot Group");
  });

  it("prefers the large right-hand detail pane over a list-row preview", () => {
    const html = `
      <div id="app">
        <div class="job-list-item selected" aria-selected="true">${MINDBODY_CARD}</div>
        <div class="job-panel">
          <h2>Sr Software Engineer</h2>
          <p>Mindbody</p>
          ${MINDBODY_CARD}
          ${MINDBODY_BODY}
        </div>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const panel = findMyGreenhouseDetailPanel(doc);
    expect(panel?.className).toBe("job-panel");

    const meta = extractTitleCompanyFromPanel(panel!);
    expect(meta.company).toBe("Mindbody");
  });

  it("parses title, company, and body from a job detail panel", () => {
    const parsed = parseMyGreenhouseJobText(`${MINDBODY_CARD}${MINDBODY_BODY}`);
    expect(parsed).not.toBeNull();
    expect(parsed!.company).toBe("Mindbody");
    expect(parsed!.text).toContain("At Mindbody we help wellness businesses grow");
    expect(parsed!.text).not.toMatch(/Profile checklist/i);
  });

  it("flags dashboard chrome as aggregator noise", () => {
    const noisy =
      "HomeProfileApplicationsJobsDream Job Profile checklist Drop your resume or browse to autofill";
    expect(isMyGreenhouseAggregatorNoise(noisy)).toBe(true);
  });
});
