import { describe, expect, it } from "vitest";
import {
  APPLICATION_FORM_CONFIDENCE_THRESHOLD,
  detectApplicationForm,
  detectPlatformFromHost,
  isKnownAtsSurface,
} from "../../content/autofill/detector.js";

function loadHtml(html: string): Document {
  const doc = document.implementation.createHTMLDocument("fixture");
  doc.body.innerHTML = html;
  return doc;
}

const GREENHOUSE_FORM = `
<form id="application_form">
  <input name="job_application[first_name]" id="first_name" placeholder="First Name" />
  <input name="job_application[last_name]" id="last_name" placeholder="Last Name" />
  <input name="job_application[email]" id="email" type="email" placeholder="Email" />
  <input name="job_application[phone]" id="phone" type="tel" placeholder="Phone" />
  <input name="job_application[resume]" id="resume" type="file" aria-label="Resume/CV" />
</form>
`;

const NEWS_ARTICLE = `
<article>
  <h1>Markets rally on jobs report</h1>
  <p>Stocks climbed after the latest employment data beat expectations.</p>
</article>
`;

const CONTACT_FORM = `
<form id="contact">
  <label for="contact_name">Name</label>
  <input id="contact_name" name="name" />
  <label for="contact_email">Email</label>
  <input id="contact_email" name="email" type="email" />
  <label for="contact_message">Message</label>
  <textarea id="contact_message" name="message"></textarea>
</form>
`;

/**
 * Workday "My Information", step 1 of 6 — the real shape users land on.
 *
 * Deliberately only carries ONE strong identity concept (first_name): with
 * both first_name and last_name present the identity score alone clears the
 * offer threshold (correctly — two distinct named fields are strong
 * evidence), which would stop this fixture from exercising the
 * known-ATS-surface fallback it is meant to test.
 */
const WORKDAY_MY_INFORMATION = `
<form>
  <label for="country">Country / Territory</label>
  <select id="country" name="country"><option>United States of America</option></select>
  <label for="firstName">First Name</label>
  <input id="firstName" data-automation-id="legalNameSection_firstName" />
  <label for="addressLine1">Address Line 1</label>
  <input id="addressLine1" data-automation-id="addressSection_addressLine1" />
  <label for="city">City</label>
  <input id="city" data-automation-id="addressSection_city" />
  <label for="state">State</label>
  <select id="state" name="state"><option>Select One</option></select>
  <label for="postalCode">Postal Code</label>
  <input id="postalCode" data-automation-id="addressSection_postalCode" />
</form>
`;

describe("detectPlatformFromHost", () => {
  it("detects Greenhouse hosts", () => {
    expect(detectPlatformFromHost("boards.greenhouse.io")).toBe("greenhouse");
    expect(detectPlatformFromHost("acme.greenhouse.io")).toBe("greenhouse");
  });

  it("detects LinkedIn hosts", () => {
    expect(detectPlatformFromHost("www.linkedin.com")).toBe("linkedin");
  });

  it("returns unknown for unrelated hosts", () => {
    expect(detectPlatformFromHost("example.com")).toBe("unknown");
  });

  it("detects Workday recruiting hosts", () => {
    expect(detectPlatformFromHost("workday.wd5.myworkdayjobs.com")).toBe("workday");
    expect(detectPlatformFromHost("wd5.myworkday.com")).toBe("workday");
  });
});

describe("detectApplicationForm", () => {
  it("detects a Greenhouse-shaped application form above the offer threshold", () => {
    const doc = loadHtml(GREENHOUSE_FORM);
    const result = detectApplicationForm(doc.body, "boards.greenhouse.io");

    expect(result.platform).toBe("greenhouse");
    expect(result.confidence).toBeGreaterThanOrEqual(APPLICATION_FORM_CONFIDENCE_THRESHOLD);
    expect(result.isApplicationForm).toBe(true);
    expect(result.fieldCandidates.map((c) => c.concept)).toEqual(
      expect.arrayContaining(["first_name", "last_name", "email", "phone", "resume"]),
    );
  });

  it("does not flag a news article as an application form", () => {
    const doc = loadHtml(NEWS_ARTICLE);
    const result = detectApplicationForm(doc.body, "example.com");

    expect(result.isApplicationForm).toBe(false);
    expect(result.confidence).toBeLessThan(APPLICATION_FORM_CONFIDENCE_THRESHOLD);
    expect(result.fieldCandidates).toHaveLength(0);
  });

  it("detects application fields inside open shadow roots (Workday-style widgets)", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <label for="legalName--firstName">First Name</label>
      <input id="legalName--firstName" name="firstName" placeholder="First Name" />
      <label for="legalName--lastName">Last Name</label>
      <input id="legalName--lastName" name="lastName" placeholder="Last Name" />
      <input name="email" type="email" placeholder="Email" />
      <input name="phone" type="tel" placeholder="Phone" />
    `;
    document.body.appendChild(host);

    const result = detectApplicationForm(document.body, "workday.wd5.myworkdayjobs.com");
    expect(result.platform).toBe("workday");
    expect(result.isApplicationForm).toBe(true);
    expect(result.fieldCandidates.map((c) => c.concept)).toEqual(
      expect.arrayContaining(["first_name", "last_name", "email", "phone"]),
    );

    host.remove();
  });

  it("keeps a generic contact form below the offer threshold", () => {
    const doc = loadHtml(CONTACT_FORM);
    const result = detectApplicationForm(doc.body, "example.com");

    expect(result.isApplicationForm).toBe(false);
    expect(result.confidence).toBeLessThan(APPLICATION_FORM_CONFIDENCE_THRESHOLD);
    expect(result.fieldCandidates.map((c) => c.concept)).toEqual(
      expect.arrayContaining(["name", "email"]),
    );
  });

  it("offers on a Workday 'My Information' step that the score alone would miss", () => {
    const doc = loadHtml(WORKDAY_MY_INFORMATION);
    const result = detectApplicationForm(doc.body, "workday.wd5.myworkdayjobs.com");

    expect(result.platform).toBe("workday");
    // This step has no email/phone, so the identity-concept score cannot reach
    // the threshold on its own — the known-ATS surface predicate must carry it.
    expect(result.confidence).toBeLessThan(APPLICATION_FORM_CONFIDENCE_THRESHOLD);
    expect(result.isApplicationForm).toBe(true);
    expect(result.fieldCandidates.map((c) => c.concept)).toEqual(
      expect.arrayContaining(["first_name", "city", "state", "postal_code", "country"]),
    );
  });

  it("clears the offer threshold on the score alone when both first and last name are present", () => {
    // With split first_name/last_name concepts, a step with BOTH distinct
    // name fields (the common real-world Workday "My Information" shape) is
    // strong enough identity evidence to clear the threshold without needing
    // the known-ATS-surface fallback — a step up from the pre-split behavior,
    // where first/last name collapsed into a single "name" concept.
    const doc = loadHtml(`
      <form>
        <label for="firstName">First Name</label>
        <input id="firstName" data-automation-id="legalNameSection_firstName" />
        <label for="lastName">Last Name</label>
        <input id="lastName" data-automation-id="legalNameSection_lastName" />
        <label for="addressLine1">Address Line 1</label>
        <input id="addressLine1" data-automation-id="addressSection_addressLine1" />
        <label for="city">City</label>
        <input id="city" data-automation-id="addressSection_city" />
      </form>
    `);
    const result = detectApplicationForm(doc.body, "workday.wd5.myworkdayjobs.com");

    expect(result.platform).toBe("workday");
    expect(result.confidence).toBeGreaterThanOrEqual(APPLICATION_FORM_CONFIDENCE_THRESHOLD);
    expect(result.isApplicationForm).toBe(true);
    expect(result.fieldCandidates.map((c) => c.concept)).toEqual(
      expect.arrayContaining(["first_name", "last_name"]),
    );
  });

  it("does not offer on a known ATS page with too few inputs to be a form", () => {
    // Has a <form> and data-automation-id, so only the input-count guard can
    // reject it.
    const doc = loadHtml(`
      <form data-automation-id="searchBar">
        <input name="q" placeholder="Search for jobs" />
        <input name="email" type="email" placeholder="Email alerts" />
        <select name="location"><option>Any location</option></select>
      </form>
    `);
    const result = detectApplicationForm(doc.body, "workday.wd5.myworkdayjobs.com");

    expect(result.platform).toBe("workday");
    expect(result.isApplicationForm).toBe(false);
  });

  it("does not offer on a Workday sign-in page", () => {
    const doc = loadHtml(`
      <form data-automation-id="signInFormo">
        <label for="si-email">Email Address</label>
        <input id="si-email" type="email" data-automation-id="email" />
        <label for="si-pw">Password</label>
        <input id="si-pw" type="password" data-automation-id="password" />
        <label for="si-pw2">Verify New Password</label>
        <input id="si-pw2" type="password" data-automation-id="verifyPassword" />
        <input type="checkbox" id="si-remember" /><label for="si-remember">Remember me</label>
      </form>
    `);
    const result = detectApplicationForm(doc.body, "workday.wd5.myworkdayjobs.com");

    expect(result.platform).toBe("workday");
    // Email alone must not be enough breadth to look like a data-entry form.
    expect(result.isApplicationForm).toBe(false);
  });

  it("does not offer on a job-search filter bar with many inputs", () => {
    const doc = loadHtml(`
      <form data-automation-id="jobSearchFilters">
        <input name="q" placeholder="Search by job title" />
        <input name="loc" placeholder="Location or city" />
        <select name="category"><option>All categories</option></select>
        <select name="type"><option>Full time</option></select>
        <input type="checkbox" id="remote" /><label for="remote">Remote</label>
      </form>
    `);
    const result = detectApplicationForm(doc.body, "workday.wd5.myworkdayjobs.com");

    expect(result.platform).toBe("workday");
    expect(result.isApplicationForm).toBe(false);
  });

  it("rejects a known-ATS page that lacks identity-field breadth", () => {
    // Known limitation, pinned deliberately: name + email + a form shell on a
    // known ATS host reaches 0.59 on the long-standing threshold path, so a
    // candidate dashboard can still be *offered* autofill. That path predates
    // the surface predicate and tightening it would regress Greenhouse, which
    // scores the same way. The surface predicate itself must not add new false
    // positives, so it requires 3+ concepts including a strong identity one.
    const doc = loadHtml(`
      <form data-automation-id="candidateHome">
        <input name="search" placeholder="Find an application" />
        <input name="ref" placeholder="Reference number" />
        <select name="sort"><option>Most recent</option></select>
        <select name="status"><option>Any status</option></select>
      </form>
    `);
    const result = detectApplicationForm(doc.body, "workday.wd5.myworkdayjobs.com");

    expect(result.platform).toBe("workday");
    expect(isKnownAtsSurface(doc.body, "workday.wd5.myworkdayjobs.com", result.fieldCandidates)).toBe(
      false,
    );
    expect(result.isApplicationForm).toBe(false);
  });

  it("offers on a Workday step with no <form> element, keyed only by automation ids", () => {
    // Real Workday steps are custom elements with shadowed inputs and often no
    // <form>, so the data-automation-id branch must carry detection alone.
    const host = document.createElement("div");
    host.setAttribute("data-automation-id", "applyFlowPage");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <label for="wd-first">First Name</label><input id="wd-first" />
      <label for="wd-last">Last Name</label><input id="wd-last" />
      <label for="wd-addr">Address Line 1</label><input id="wd-addr" />
      <label for="wd-city">City</label><input id="wd-city" />
      <label for="wd-zip">Postal Code</label><input id="wd-zip" />
    `;
    document.body.appendChild(host);

    const result = detectApplicationForm(document.body, "workday.wd5.myworkdayjobs.com");
    expect(document.body.querySelector("form")).toBeNull();
    expect(result.isApplicationForm).toBe(true);

    host.remove();
  });

  it("keeps an address-bearing contact form on an unknown host below the threshold", () => {
    // Guards the new address/geo concepts: they must stay weak enough that a
    // generic form cannot cross the threshold off a known ATS host.
    const doc = loadHtml(`
      <form>
        <label for="n">Your Name</label><input id="n" name="n" />
        <label for="e">Email</label><input id="e" name="e" type="email" />
        <label for="c">City</label><input id="c" name="c" />
        <label for="s">State</label><input id="s" name="s" />
        <label for="z">Zip Code</label><input id="z" name="z" />
        <label for="co">Country</label><input id="co" name="co" />
        <label for="a">Address</label><input id="a" name="a" />
      </form>
    `);
    const result = detectApplicationForm(doc.body, "example.com");

    expect(result.platform).toBe("unknown");
    expect(result.confidence).toBeLessThan(APPLICATION_FORM_CONFIDENCE_THRESHOLD);
    expect(result.isApplicationForm).toBe(false);
  });
});
