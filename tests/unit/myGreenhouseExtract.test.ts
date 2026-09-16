import { describe, expect, it } from "vitest";
import {
  extractMyGreenhouseFromDocument,
  isMyGreenhouseHost,
  parseMyGreenhouseJobText,
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

describe("myGreenhouseExtract", () => {
  it("detects my.greenhouse.io host", () => {
    expect(isMyGreenhouseHost("my.greenhouse.io")).toBe(true);
    expect(isMyGreenhouseHost("boards.greenhouse.io")).toBe(false);
  });

  it("parses title, company, and body from a job detail panel", () => {
    const parsed = parseMyGreenhouseJobText(SAMPLE_HEADER);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toContain("Software Engineer");
    expect(parsed!.company).toBe("AlertMedia");
    expect(parsed!.text).toContain("Do work that matters");
    expect(parsed!.text).not.toMatch(/Profile checklist/i);
  });

  it("flags dashboard chrome as aggregator noise", () => {
    const noisy =
      "HomeProfileApplicationsJobsDream Job Profile checklist Drop your resume or browse to autofill";
    expect(isMyGreenhouseAggregatorNoise(noisy)).toBe(true);
  });

  it("extracts from the smallest DOM panel containing Posted", () => {
    const html = `
      <div id="app">
        <nav>HomeProfileApplicationsJobsDream Job</nav>
        <div class="job-panel">
          ${SAMPLE_HEADER}
        </div>
        <aside>Profile checklist Drop your resume</aside>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const parsed = extractMyGreenhouseFromDocument(doc);
    expect(parsed?.company).toBe("AlertMedia");
    expect(parsed?.text).toContain("AlertMedia, we help organizations");
    expect(parsed?.text).not.toContain("Profile checklist");
  });
});
