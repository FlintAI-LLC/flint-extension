import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectApplicationForm } from "../../content/autofill/detector.js";
import { fillApplicationForm } from "../../content/autofill/fill-engine.js";
import { fillGreenhouse } from "../../content/autofill/greenhouse.js";
import type { AutofillPayload } from "../../content/autofill/types.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/autofill");
const FIXTURE_DIR = join(FIXTURES_ROOT, "greenhouse");

function loadFixture(name: string, fixtureDir = FIXTURE_DIR): Document {
  const html = readFileSync(join(fixtureDir, name), "utf8");
  const doc = document.implementation.createHTMLDocument("fixture");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  doc.body.innerHTML = bodyMatch?.[1] ?? html;
  return doc;
}

const SAMPLE_PAYLOAD: AutofillPayload = {
  jd_id: "jd-1",
  platform: "greenhouse",
  fields: [
    {
      key: "first_name",
      selector: "[name='job_application[first_name]']",
      value: "Alex",
    },
    {
      key: "last_name",
      selector: "[name='job_application[last_name]']",
      value: "Rivera",
    },
    {
      key: "email",
      selector: "[name='job_application[email]']",
      value: "alex@example.com",
    },
    {
      key: "phone",
      selector: "[name='job_application[phone]']",
      value: "555-0100",
    },
    {
      key: "resume",
      selector: "[name='job_application[resume]']",
      value: "/tmp/resume.pdf",
    },
    {
      key: "linkedin_url",
      selector: "[name='job_application[urls][LinkedIn]']",
      value: "https://www.linkedin.com/in/alex",
    },
    {
      key: "work_authorization",
      selector: "[name='job_application[answers][work_authorization]']",
      value: "Yes",
    },
  ],
};

describe("fillGreenhouse", () => {
  it("fills text and select fields with high confidence on the fixture form", () => {
    const doc = loadFixture("apply-form.html");
    const detection = detectApplicationForm(doc.body, "boards.greenhouse.io");
    const result = fillGreenhouse(SAMPLE_PAYLOAD, detection.fieldCandidates, doc.body);

    expect(result.percent_filled).toBeGreaterThanOrEqual(85);

    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f]));
    expect(byKey.first_name?.status).toBe("filled_high_confidence");
    expect(byKey.email?.status).toBe("filled_high_confidence");
    expect(byKey.resume?.status).toBe("not_applicable_file_upload");
    expect(byKey.work_authorization?.status).toBe("filled_high_confidence");

    expect((doc.querySelector("[name='job_application[email]']") as HTMLInputElement).value).toBe(
      "alex@example.com",
    );
    expect(
      (doc.querySelector("[name='job_application[answers][work_authorization]']") as HTMLSelectElement)
        .value,
    ).toBe("yes");
  });

  it("linkedin stub returns empty result", async () => {
    const { fillLinkedIn } = await import("../../content/autofill/linkedin.js");
    const result = fillLinkedIn({ jd_id: "jd-2", platform: "linkedin", fields: [] });
    expect(result.fields).toHaveLength(0);
    expect(result.percent_filled).toBe(0);
  });
});

describe("fillGreenhouse on the redesigned job-boards.greenhouse.io DOM", () => {
  // Regression coverage for a live production bug (2026-10-15): the modern
  // Greenhouse apply form has no `name="job_application[...]"` attributes at
  // all, so every field falls through the static selector map to the
  // detector's heuristic concept matching. first_name/last_name used to
  // share a single "name" concept, so both payload fields resolved to the
  // *same* element and the second write silently clobbered the first.
  const REDESIGN_PAYLOAD: AutofillPayload = {
    jd_id: "jd-redesign",
    platform: "greenhouse",
    fields: [
      { key: "first_name", selector: "[name='job_application[first_name]']", value: "Alex" },
      { key: "last_name", selector: "[name='job_application[last_name]']", value: "Rivera" },
      { key: "email", selector: "[name='job_application[email]']", value: "alex@example.com" },
      { key: "phone", selector: "[name='job_application[phone]']", value: "555-0100" },
      {
        key: "linkedin_url",
        selector: "[name='job_application[urls][LinkedIn]']",
        value: "https://www.linkedin.com/in/alex",
      },
      { key: "website_url", selector: "", value: "https://alexrivera.dev" },
      { key: "github_url", selector: "", value: "https://github.com/alexrivera" },
      { key: "resume", selector: "[name='job_application[resume]']", value: "/tmp/resume.pdf" },
    ],
  };

  it("fills phone, LinkedIn, and GitHub on the redesigned DOM via aria-label heuristics", () => {
    const doc = loadFixture("apply-form-redesign.html");
    const detection = detectApplicationForm(doc.body, "job-boards.greenhouse.io");
    const result = fillGreenhouse(REDESIGN_PAYLOAD, detection.fieldCandidates, doc.body);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f]));

    expect((doc.getElementById("phone") as HTMLInputElement).value).toBe("555-0100");
    expect(byKey.phone?.status).toBe("filled_needs_review");

    expect((doc.getElementById("question_38765485002") as HTMLInputElement).value).toBe(
      "https://www.linkedin.com/in/alex",
    );
    expect(byKey.linkedin_url?.status).toBe("filled_needs_review");

    expect((doc.getElementById("question_38765487002") as HTMLInputElement).value).toBe(
      "https://github.com/alexrivera",
    );
    expect(byKey.github_url?.status).toBe("filled_needs_review");
  });

  it("fills first and last name into their own distinct inputs, not one shared field", () => {
    const doc = loadFixture("apply-form-redesign.html");
    const detection = detectApplicationForm(doc.body, "job-boards.greenhouse.io");
    const result = fillGreenhouse(REDESIGN_PAYLOAD, detection.fieldCandidates, doc.body);

    expect((doc.getElementById("first_name") as HTMLInputElement).value).toBe("Alex");
    expect((doc.getElementById("last_name") as HTMLInputElement).value).toBe("Rivera");
    expect((doc.getElementById("email") as HTMLInputElement).value).toBe("alex@example.com");

    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f]));
    expect(byKey.first_name?.status).toBe("filled_needs_review");
    expect(byKey.last_name?.status).toBe("filled_needs_review");
  });

  it("matches the Portfolio Website question via aria-label heuristics", () => {
    const doc = loadFixture("apply-form-redesign.html");
    const detection = detectApplicationForm(doc.body, "job-boards.greenhouse.io");
    const result = fillGreenhouse(REDESIGN_PAYLOAD, detection.fieldCandidates, doc.body);

    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f]));
    expect(byKey.website_url?.status).toBe("filled_needs_review");
    expect((doc.getElementById("question_38765486002") as HTMLInputElement).value).toBe(
      "https://alexrivera.dev",
    );
  });

  it("reports the selector that actually resolved the element, for jump-to-field", () => {
    const doc = loadFixture("apply-form-redesign.html");
    const detection = detectApplicationForm(doc.body, "job-boards.greenhouse.io");
    const result = fillGreenhouse(REDESIGN_PAYLOAD, detection.fieldCandidates, doc.body);

    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f]));
    // The payload's static selectors never match this DOM — reporting them
    // back (as the pre-fix code did) means "jump to field" targets nothing.
    expect(byKey.first_name?.selector).toBe("#first_name");
    expect(byKey.last_name?.selector).toBe("#last_name");
    expect(byKey.last_name?.selector).not.toBe(REDESIGN_PAYLOAD.fields[1].selector);
  });
});

describe("fillApplicationForm combined Full Name fallback", () => {
  it("writes 'First Last' into a single combined Name field instead of leaving it empty", () => {
    const doc = document.implementation.createHTMLDocument("fixture");
    const nameInput = doc.createElement("input");
    nameInput.id = "contact_name";
    nameInput.setAttribute("aria-label", "Full Name");
    doc.body.appendChild(nameInput);
    const emailInput = doc.createElement("input");
    emailInput.id = "contact_email";
    emailInput.setAttribute("aria-label", "Email");
    doc.body.appendChild(emailInput);

    const detection = detectApplicationForm(doc.body, "careers.acme.example");
    const payload: AutofillPayload = {
      jd_id: "jd-combined-name",
      platform: "unknown",
      fields: [
        { key: "first_name", selector: "", value: "Alex" },
        { key: "last_name", selector: "", value: "Rivera" },
        { key: "email", selector: "", value: "alex@example.com" },
      ],
    };

    const result = fillApplicationForm(payload, detection.fieldCandidates, doc.body);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f]));

    // Pre-fix behavior: both writes raced for the same element and the
    // *second* one silently clobbered the first. A regression here would
    // either leave the field empty (not_found) or contain only "Rivera".
    expect(nameInput.value).toBe("Alex Rivera");
    expect(byKey.first_name?.status).toBe("filled_needs_review");
    expect(byKey.last_name?.status).toBe("filled_needs_review");
  });

  it("does not touch the combined-name fallback when distinct first/last fields exist", () => {
    const doc = loadFixture("apply-form-redesign.html");
    const detection = detectApplicationForm(doc.body, "job-boards.greenhouse.io");
    const payload: AutofillPayload = {
      jd_id: "jd-split-name",
      platform: "greenhouse",
      fields: [
        { key: "first_name", selector: "", value: "Alex" },
        { key: "last_name", selector: "", value: "Rivera" },
      ],
    };

    fillGreenhouse(payload, detection.fieldCandidates, doc.body);

    expect((doc.getElementById("first_name") as HTMLInputElement).value).toBe("Alex");
    expect((doc.getElementById("last_name") as HTMLInputElement).value).toBe("Rivera");
  });
});

describe("fillApplicationForm select verification", () => {
  function buildCountrySelect(doc: Document): HTMLSelectElement {
    const select = doc.createElement("select");
    select.id = "country";
    select.setAttribute("aria-label", "Country");
    const option = doc.createElement("option");
    // Deliberately mismatched option value vs. visible text — this is the
    // normal shape of a real country/work-authorization <select>.
    option.value = "US";
    option.textContent = "United States of America";
    select.appendChild(option);
    doc.body.appendChild(select);
    return select;
  }

  it("verifies against the matched option's value, not the free-text label", () => {
    const doc = document.implementation.createHTMLDocument("fixture");
    buildCountrySelect(doc);

    const payload: AutofillPayload = {
      jd_id: "jd-select",
      platform: "unknown",
      fields: [{ key: "country", selector: "#country", value: "United States of America" }],
    };

    const result = fillApplicationForm(payload, [], doc.body);
    // Pre-fix bug: comparing el.value ("US") against the free-text value
    // ("united states of america") never matches, so this would have been
    // misreported as fill_rejected despite the select being filled correctly.
    expect(result.fields[0]?.status).not.toBe("fill_rejected");
    expect((doc.getElementById("country") as HTMLSelectElement).value).toBe("US");
  });

  it("reports fill_rejected when a select's value is reverted after being set", () => {
    const doc = document.implementation.createHTMLDocument("fixture");
    const select = buildCountrySelect(doc);
    select.addEventListener("input", () => {
      select.value = "";
    });

    const payload: AutofillPayload = {
      jd_id: "jd-select-bounce",
      platform: "unknown",
      fields: [{ key: "country", selector: "#country", value: "United States of America" }],
    };

    const result = fillApplicationForm(payload, [], doc.body);
    expect(result.fields[0]?.status).toBe("fill_rejected");
    expect(result.percent_filled).toBe(0);
  });
});

describe("fillApplicationForm honesty guarantees", () => {
  it("reports fill_rejected (never filled_*) when a controlled field bounces the write back to empty", () => {
    const doc = document.implementation.createHTMLDocument("fixture");
    const input = doc.createElement("input");
    input.id = "stubborn-email";
    input.setAttribute("aria-label", "Email");
    // Simulates a framework-controlled input that reverts any programmatic
    // write back to its own tracked (still-empty) state.
    input.addEventListener("input", () => {
      input.value = "";
    });
    doc.body.appendChild(input);

    const payload: AutofillPayload = {
      jd_id: "jd-stubborn",
      platform: "unknown",
      fields: [{ key: "email", selector: "#stubborn-email", value: "alex@example.com" }],
    };

    const result = fillApplicationForm(payload, [], doc.body);
    expect(result.fields[0]?.status).toBe("fill_rejected");
    // The whole point: a rejected write must never count toward "filled".
    expect(result.percent_filled).toBe(0);
  });
});

describe("fillApplicationForm (shared engine)", () => {
  it("matches fillGreenhouse's fill rate when forced onto the greenhouse selector map", () => {
    const doc = loadFixture("apply-form.html");
    const detection = detectApplicationForm(doc.body, "boards.greenhouse.io");
    const result = fillApplicationForm(SAMPLE_PAYLOAD, detection.fieldCandidates, doc.body, {
      preferSelectorMap: "greenhouse",
    });

    expect(result.percent_filled).toBeGreaterThanOrEqual(85);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f]));
    expect(byKey.first_name?.status).toBe("filled_high_confidence");
    expect(byKey.resume?.status).toBe("not_applicable_file_upload");
  });

  it("fills a generic unknown-platform form via detector heuristics with needs_review statuses", () => {
    const doc = loadFixture("apply-form.html", join(FIXTURES_ROOT, "generic"));
    const detection = detectApplicationForm(doc.body, "careers.acme.example");
    expect(detection.platform).toBe("unknown");
    expect(detection.isApplicationForm).toBe(true);

    const payload: AutofillPayload = {
      jd_id: "jd-generic",
      platform: "unknown",
      fields: [
        { key: "email", selector: "", value: "sam@example.com" },
        { key: "phone", selector: "", value: "555-0111" },
        { key: "linkedin_url", selector: "", value: "https://www.linkedin.com/in/sam" },
        { key: "work_authorization", selector: "", value: "Yes" },
        { key: "resume", selector: "", value: "/tmp/resume.pdf" },
      ],
    };

    const result = fillApplicationForm(payload, detection.fieldCandidates, doc.body);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f]));

    expect(byKey.email?.status).toBe("filled_needs_review");
    expect(byKey.phone?.status).toBe("filled_needs_review");
    expect(byKey.linkedin_url?.status).toBe("filled_needs_review");
    expect(byKey.work_authorization?.status).toBe("filled_needs_review");
    expect(byKey.resume?.status).toBe("not_applicable_file_upload");

    expect((doc.querySelector("#candidate-email") as HTMLInputElement).value).toBe("sam@example.com");
    expect((doc.querySelector("#candidate-phone") as HTMLInputElement).value).toBe("555-0111");
  });

  it("never writes into file inputs even when a payload selector targets one directly", () => {
    const doc = loadFixture("apply-form.html", join(FIXTURES_ROOT, "generic"));
    const payload: AutofillPayload = {
      jd_id: "jd-generic-2",
      platform: "unknown",
      fields: [{ key: "resume", selector: "#candidate-resume", value: "/tmp/resume.pdf" }],
    };

    const result = fillApplicationForm(payload, [], doc.body);
    expect(result.fields[0]?.status).toBe("not_applicable_file_upload");
    expect((doc.querySelector("#candidate-resume") as HTMLInputElement).value).toBe("");
  });
});
