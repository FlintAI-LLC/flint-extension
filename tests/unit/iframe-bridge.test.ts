import { describe, expect, it } from "vitest";
import { hasGreenhouseApplyIframe, scoreFillResult } from "../../content/autofill/iframe-bridge.js";
import type { FillResult } from "../../content/autofill/types.js";

describe("hasGreenhouseApplyIframe", () => {
  it("detects job-boards embed iframes used by MyGreenhouse", () => {
    const doc = document.implementation.createHTMLDocument("mygh");
    doc.body.innerHTML = `
      <iframe src="https://job-boards.greenhouse.io/embed/job_app?for=mitratech&token=123"></iframe>
    `;
    expect(hasGreenhouseApplyIframe(doc)).toBe(true);
  });

  it("ignores unrelated iframes", () => {
    const doc = document.implementation.createHTMLDocument("page");
    doc.body.innerHTML = `<iframe src="https://example.com/widget"></iframe>`;
    expect(hasGreenhouseApplyIframe(doc)).toBe(false);
  });

  it("detects lazy-loaded embed iframes via data-src", () => {
    const doc = document.implementation.createHTMLDocument("mygh");
    doc.body.innerHTML = `
      <iframe data-src="https://job-boards.greenhouse.io/embed/job_app?for=mitratech&token=123"></iframe>
    `;
    expect(hasGreenhouseApplyIframe(doc)).toBe(true);
  });
});

describe("scoreFillResult", () => {
  it("counts both high-confidence and needs-review fills", () => {
    const result: FillResult = {
      percent_filled: 50,
      fields: [
        { key: "first_name", selector: null, status: "filled_high_confidence" },
        { key: "last_name", selector: null, status: "filled_needs_review" },
        { key: "resume", selector: null, status: "not_applicable_file_upload" },
        { key: "email", selector: null, status: "not_found" },
      ],
    };
    expect(scoreFillResult(result)).toBe(2);
  });
});
