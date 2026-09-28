import { describe, expect, it } from "vitest";
import {
  boardsApiJobUrl,
  collectEmbedRefsFromHtml,
  collectGreenhouseBoardJobRefs,
  jobFromBoardsApiPayload,
  parseGreenhouseBoardApiJobUrl,
  parseGreenhouseBoardJobUrl,
  parseGreenhouseEmbedJobUrl,
} from "../../src/greenhouseBoardsApi.js";

describe("greenhouseBoardsApi", () => {
  it("parses job-boards and boards posting URLs", () => {
    expect(
      parseGreenhouseBoardJobUrl(
        "https://job-boards.greenhouse.io/alertmedia/jobs/8661716002",
      ),
    ).toEqual({
      boardToken: "alertmedia",
      jobId: "8661716002",
      source: "https://job-boards.greenhouse.io/alertmedia/jobs/8661716002",
    });
    expect(
      parseGreenhouseBoardJobUrl("https://boards.greenhouse.io/acme/jobs/42")?.jobId,
    ).toBe("42");
  });

  it("parses boards-api job URLs", () => {
    expect(
      parseGreenhouseBoardApiJobUrl(
        "https://boards-api.greenhouse.io/v1/boards/alertmedia/jobs/8661716002?content=true",
      )?.boardToken,
    ).toBe("alertmedia");
  });

  it("builds boards-api job URL", () => {
    expect(boardsApiJobUrl("alertmedia", "123")).toBe(
      "https://boards-api.greenhouse.io/v1/boards/alertmedia/jobs/123?content=true",
    );
  });

  it("converts API payload HTML content into plain JD text", () => {
    const parsed = jobFromBoardsApiPayload({
      title: "Sr Software Engineer",
      company_name: "AlertMedia",
      content:
        "<p>Do work that matters.</p><p>At AlertMedia we help organizations stay safe.</p>" +
        "<p>Who you are: collaborative engineer.</p><p>What you get to do: build APIs.</p>" +
        "<p>What you bring: 6+ years of experience building scalable web applications with strong communication skills.</p>",
    });
    expect(parsed?.title).toBe("Sr Software Engineer");
    expect(parsed?.company).toBe("AlertMedia");
    expect(parsed?.text).toContain("At AlertMedia we help organizations stay safe");
    expect(parsed?.text.length).toBeGreaterThanOrEqual(200);
  });

  it("parses embed job_app URLs used by MyGreenhouse", () => {
    expect(
      parseGreenhouseEmbedJobUrl(
        "https://job-boards.greenhouse.io/embed/job_app?for=alertmedia&token=8661716002",
      ),
    ).toEqual({
      boardToken: "alertmedia",
      jobId: "8661716002",
      source: "https://job-boards.greenhouse.io/embed/job_app?for=alertmedia&token=8661716002",
    });
    const refs = collectEmbedRefsFromHtml(
      '<iframe src="https://job-boards.greenhouse.io/embed/job_app?for=mindbody&amp;token=1234567890"></iframe>',
    );
    expect(refs[0]?.boardToken).toBe("mindbody");
    expect(refs[0]?.jobId).toBe("1234567890");
  });

  it("collects unique board/job refs from anchors and inline HTML", () => {
    const html = `
      <div id="app">
        <a href="https://job-boards.greenhouse.io/alertmedia/jobs/111">Apply</a>
        <a href="https://job-boards.greenhouse.io/alertmedia/jobs/222">Apply</a>
        <span>boards-api.greenhouse.io/v1/boards/mindbody/jobs/333</span>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const refs = collectGreenhouseBoardJobRefs(doc);
    expect(refs.map((ref) => ref.jobId).sort()).toEqual(["111", "222", "333"]);
  });
});
