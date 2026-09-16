import { beforeEach, describe, expect, it } from "vitest";
import {
  extractMyGreenhouseFromDocument,
  extractTitleCompanyFromPanel,
  findMyGreenhouseDetailPanel,
  isMyGreenhouseBrandName,
  isMyGreenhouseHost,
  parseMyGreenhouseJobText,
  sanitizeMyGreenhouseExtractedFields,
} from "../../src/myGreenhouseExtract.js";
import { isMyGreenhouseAggregatorNoise } from "../../src/jdParse.js";

const SAMPLE_HEADER = `
Sr. Software Engineer
AlertMedia
Remote
Austin, TX
Posted · 36 minutes ago
Do work that matters.

At AlertMedia, we help organizations protect their people, operations, and brand.
You thrive in a collaborative engineering environment that plays to everyone's strengths.
What you get to do every day:
Build and ship features for the AI Assistant and Orchestration products.
What you bring to the role:
6+ years of experience building scalable web applications, Python/Django/React/Node tech stack preferred.
`;

function mockFlexLayoutRects(): void {
  Element.prototype.getBoundingClientRect = function () {
    const el = this as Element;
    if (el.className === "job-panel") {
      return {
        left: 360,
        width: 700,
        height: 800,
        top: 0,
        right: 1020,
        bottom: 800,
        x: 320,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
    if (el.tagName === "NAV") {
      return {
        left: 0,
        width: 300,
        height: 800,
        top: 0,
        right: 300,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return {
      left: 0,
      width: 1200,
      height: 800,
      top: 0,
      right: 1200,
      bottom: 800,
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

  it("parses title, company, and body from a job detail panel", () => {
    const parsed = parseMyGreenhouseJobText(SAMPLE_HEADER);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toContain("Software Engineer");
    expect(parsed!.company).toBe("AlertMedia");
    expect(parsed!.text).toContain("Do work that matters");
    expect(parsed!.text).not.toMatch(/Profile checklist/i);
  });

  it("accepts Posted today without a digit after the bullet", () => {
    const parsed = parseMyGreenhouseJobText(
      SAMPLE_HEADER.replace("Posted · 36 minutes ago", "Posted today"),
    );
    expect(parsed?.company).toBe("AlertMedia");
  });

  it("flags dashboard chrome as aggregator noise", () => {
    const noisy =
      "HomeProfileApplicationsJobsDream Job Profile checklist Drop your resume or browse to autofill";
    expect(isMyGreenhouseAggregatorNoise(noisy)).toBe(true);
  });

  it("finds the right-hand flex detail pane instead of the full app shell", () => {
    const html = `
      <div id="app" style="display:flex;width:1200px">
        <nav style="width:300px">HomeProfileApplicationsJobsDream Job</nav>
        <div class="job-panel" style="width:700px;margin-left:320px">
          <h2>Sr. Software Engineer</h2>
          <p>AlertMedia</p>
          <p>Remote</p>
          <p>Posted · 36 minutes ago</p>
          ${SAMPLE_HEADER}
        </div>
        <aside>Profile checklist Drop your resume</aside>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const panel = findMyGreenhouseDetailPanel(doc);
    expect(panel?.className).toBe("job-panel");

    const meta = extractTitleCompanyFromPanel(panel!);
    expect(meta.title).toContain("Software Engineer");
    expect(meta.company).toBe("AlertMedia");
  });

  it("extracts from the smallest DOM panel containing Posted", () => {
    const html = `
      <div id="app">
        <nav>HomeProfileApplicationsJobsDream Job</nav>
        <div class="job-panel">
          <h2>Sr. Software Engineer</h2>
          <p>AlertMedia</p>
          <p>Remote</p>
          ${SAMPLE_HEADER}
        </div>
        <aside>Profile checklist Drop your resume</aside>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const parsed = extractMyGreenhouseFromDocument(doc);
    expect(parsed?.company).toBe("AlertMedia");
    expect(parsed?.title).toContain("Software Engineer");
    expect(parsed?.text).toContain("AlertMedia, we help organizations");
    expect(parsed?.text).not.toContain("Profile checklist");
  });
});
