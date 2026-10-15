import { describe, expect, it } from "vitest";
import {
  isAutofillHost,
  isWorkdayApplyUrl,
  isGreenhouseHost,
  isLinkedInHost,
} from "../../src/autofillFlags.js";

describe("autofillFlags", () => {
  it("detects Greenhouse hosts", () => {
    expect(isGreenhouseHost("https://boards.greenhouse.io/acme/jobs/123")).toBe(true);
    expect(isGreenhouseHost("https://example.com/jobs/1")).toBe(false);
  });

  it("detects LinkedIn hosts", () => {
    expect(isLinkedInHost("https://www.linkedin.com/jobs/view/123")).toBe(true);
    expect(isLinkedInHost("https://boards.greenhouse.io/acme/jobs/123")).toBe(false);
  });

  it("isAutofillHost covers autofill-runner hosts", () => {
    expect(isAutofillHost("https://boards.greenhouse.io/acme/jobs/123")).toBe(true);
    expect(isAutofillHost("https://jobs.lever.co/acme/abc")).toBe(true);
    expect(isAutofillHost("https://jobs.ashbyhq.com/acme/abc")).toBe(true);
    expect(isAutofillHost("https://acme.myworkdayjobs.com/en-US/careers")).toBe(true);
    // *.myworkday.com is the employee HRIS (payroll, personal info), not the
    // external career site. It must never become an autofill surface.
    expect(isAutofillHost("https://acme.wd5.myworkday.com/acme/d/inst/home")).toBe(false);
    expect(isAutofillHost("https://myworkday.com/")).toBe(false);
    expect(isAutofillHost("https://careers-acme.icims.com/jobs/123")).toBe(true);
    expect(isAutofillHost("https://acme.ukg.net/careers")).toBe(true);
    expect(isAutofillHost("https://jobright.ai/jobs/123")).toBe(true);
    expect(isAutofillHost("https://www.jobright.ai/jobs/123")).toBe(true);
    expect(isAutofillHost("https://www.linkedin.com/jobs/view/123")).toBe(true);
    expect(isAutofillHost("https://linkedin.com/jobs/collections/recommended")).toBe(true);
  });

  it("isAutofillHost rejects unsupported hosts and non-jobs LinkedIn", () => {
    expect(isAutofillHost("https://example.com/apply")).toBe(false);
    expect(isAutofillHost("https://www.linkedin.com/feed/")).toBe(false);
    expect(isAutofillHost("https://www.linkedin.com/in/someone")).toBe(false);
    expect(isAutofillHost(undefined)).toBe(false);
  });

  it("isWorkdayApplyUrl matches apply flows only", () => {
    expect(
      isWorkdayApplyUrl(
        "https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/Reston/Eng/apply/applyManually",
      ),
    ).toBe(true);
    expect(isWorkdayApplyUrl("https://workday.wd5.myworkdayjobs.com/en-US/careers")).toBe(false);
    expect(isWorkdayApplyUrl("https://boards.greenhouse.io/acme/jobs/1")).toBe(false);
  });
});
