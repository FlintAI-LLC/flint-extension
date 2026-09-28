import { beforeEach, describe, expect, it } from "vitest";
import {
  extractFromBodyTextSlice,
  extractMyGreenhouseFromDocument,
  extractTitleCompanyFromPanel,
  findMyGreenhouseDetailPanel,
  findSelectedJobListItem,
  isPlausibleJobHeader,
  isMyGreenhouseBrandName,
  resolveMyGreenhouseSelection,
  isMyGreenhouseHost,
  isMyGreenhousePartialExtract,
  looksLikeListCardPreview,
  parseMyGreenhouseJobText,
  sanitizeMyGreenhouseExtractedFields,
} from "../../src/myGreenhouseExtract.js";
import { isMyGreenhouseAggregatorNoise } from "../../src/jdParse.js";
import {
  writeListClickMyGreenhouseJobContext,
  writeRefMyGreenhouseJobContext,
} from "../../src/myGreenhouseContext.js";

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
    sessionStorage.clear();
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

  it("rejects location metadata as company/title", () => {
    expect(sanitizeMyGreenhouseExtractedFields("Remote", "Hyderabad, TG")).toEqual({
      title: "",
      company: "",
    });
    expect(isPlausibleJobHeader("Remote", "Hyderabad, TG")).toBe(false);
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

  it("resolves via detail header when aria-selected is absent", () => {
    const html = `
      <div id="app">
        <div class="job-list-item">${TAKEALOT_CARD}</div>
        <div class="job-list-item">${MINDBODY_CARD}</div>
        <div class="job-panel">
          <h2>Sr Software Engineer</h2>
          <p>Mindbody</p>
          ${MINDBODY_CARD}
          ${MINDBODY_BODY}
        </div>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(findSelectedJobListItem(doc)).toBeNull();
    expect(resolveMyGreenhouseSelection(doc)?.company).toBe("Mindbody");
  });

  it("list selection beats stale list-click after the fresh-click window", () => {
    const mitratech = `Software Engineer III, In Test
Mitratech
Remote
Dallas, TX
Posted · 1 month ago`;
    const rithum = `Senior Software Engineer I
Rithum
Remote
Dallas, TX
Posted · 1 month ago`;
    sessionStorage.setItem(
      "flint_mygh_list_click_v1",
      JSON.stringify({
        title: "Software Engineer III, In Test",
        company: "Mitratech",
        ts: Date.now() - 60_000,
      }),
    );
    const html = `
      <div id="app">
        <div class="job-list-item">${mitratech}</div>
        <div class="job-list-item selected" aria-selected="true">${rithum}</div>
        <div class="job-panel">
          <h2>Senior Software Engineer I</h2>
          <p>Rithum</p>
          ${rithum}
        </div>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const resolved = resolveMyGreenhouseSelection(doc);
    expect(resolved?.company).toBe("Rithum");
    expect(resolved?.title).toContain("Senior Software Engineer");
  });

  it("list-click beats stale list row from an earlier scroll position", () => {
    sessionStorage.clear();
    writeListClickMyGreenhouseJobContext({
      title: "Software Engineer",
      company: "Outschool",
    });
    const workato = `Senior Software Engineer
Workato
Remote
United States
Posted · 3 days ago`;
    const html = `
      <div id="app">
        <div class="job-list-item selected" aria-selected="true">${workato}</div>
        <div class="job-panel">
          <h2>Senior Software Engineer</h2>
          <p>Workato</p>
          ${workato}
        </div>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const resolved = resolveMyGreenhouseSelection(doc);
    expect(resolved?.company).toBe("Outschool");
  });

  it("slices full page text from the selected job header", () => {
    const html = `
      <body>
        ${TAKEALOT_CARD}
        ${MINDBODY_CARD}
        ${MINDBODY_BODY}
      </body>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const sliced = extractFromBodyTextSlice(doc, {
      title: "Sr Software Engineer",
      company: "Mindbody",
    });
    expect(sliced?.text).toContain("At Mindbody we help wellness businesses grow");
    expect(sliced?.text).not.toContain("Takealot Group");
  });

  it("rejects location-only strings as job headers", () => {
    expect(isPlausibleJobHeader("Remote", "United States")).toBe(false);
    expect(isPlausibleJobHeader("Remote", "Dallas, TX")).toBe(false);
    expect(isPlausibleJobHeader("Senior Software Engineer", "Dallas, TX")).toBe(false);
    expect(isPlausibleJobHeader("Senior Software Engineer", "Mindbody")).toBe(true);
  });

  it("resolveMyGreenhouseSelection prefers selected list row over stale detail header", () => {
    const renaissance = `Senior Software Engineer
Renaissance Learning North America
Remote
United States
Posted · 2 days ago`;
    const html = `
      <div id="app">
        <div class="job-list-item">${renaissance}</div>
        <div class="job-list-item selected" aria-selected="true">${MINDBODY_CARD}</div>
        <div class="job-panel">
          <h2>Senior Software Engineer</h2>
          <p>Renaissance Learning North America</p>
          <p>Remote</p>
          <p>United States</p>
          <p>Posted · 2 days ago</p>
        </div>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const resolved = resolveMyGreenhouseSelection(doc);
    expect(resolved?.company).toBe("Mindbody");
    expect(resolved?.title).toContain("Software Engineer");
  });

  it("resolveMyGreenhouseSelection uses list-click context when list selection is missing", () => {
    sessionStorage.clear();
    writeListClickMyGreenhouseJobContext({
      title: "Principal Software Engineer",
      company: "Code for America",
    });
    const html = `<div id="app"><div class="job-panel"></div></div>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const resolved = resolveMyGreenhouseSelection(doc);
    expect(resolved?.company).toBe("Code for America");
  });

  it("resolveMyGreenhouseSelection ignores stale legacy session cache", () => {
    sessionStorage.clear();
    sessionStorage.setItem(
      "flint_mygh_last_job_context_v1",
      JSON.stringify({
        title: "Senior Software Engineer",
        company: "Renaissance Learning North America",
        ts: Date.now(),
      }),
    );
    const mindbodyPanel = `
      <div class="job-panel">
        <h2>Sr Software Engineer</h2>
        <p>Mindbody</p>
        ${MINDBODY_CARD}
        ${MINDBODY_BODY}
      </div>
    `;
    const html = `<div id="app">${mindbodyPanel}</div>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const resolved = resolveMyGreenhouseSelection(doc);
    expect(resolved?.company).toBe("Mindbody");
  });

  it("resolveMyGreenhouseSelection can fall back to ref context", () => {
    sessionStorage.clear();
    writeRefMyGreenhouseJobContext({
      title: "Principal Software Engineer",
      company: "Code for America",
      boardToken: "codeforamerica",
      jobId: "8174930",
    });
    const html = `<div id="app"><div class="job-panel"></div></div>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const resolved = resolveMyGreenhouseSelection(doc);
    expect(resolved?.company).toBe("Code for America");
  });

  it("returns partial metadata when only title and company are known", () => {
    const html = `
      <div id="app">
        <div class="job-list-item selected" aria-selected="true">${MINDBODY_CARD}</div>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const parsed = extractMyGreenhouseFromDocument(doc);
    expect(isMyGreenhousePartialExtract(parsed!)).toBe(true);
    expect(parsed?.company).toBe("Mindbody");
  });
});
