import { describe, expect, it } from "vitest";
import { fillForPayload } from "../../content/autofill/fill-router.js";
import { detectApplicationForm } from "../../content/autofill/detector.js";
import type { AutofillPayload } from "../../content/autofill/types.js";

describe("fillForPayload routing", () => {
  it("routes greenhouse payloads through the greenhouse selector map", () => {
    document.body.innerHTML = `
      <input name="job_application[email]" />
    `;
    const payload: AutofillPayload = {
      jd_id: "jd-gh",
      platform: "greenhouse",
      fields: [{ key: "email", selector: "#not-used", value: "alex@example.com" }],
    };

    const result = fillForPayload(payload, [], document.body);

    expect(result.fields[0]?.status).toBe("filled_high_confidence");
    expect(
      (document.querySelector("[name='job_application[email]']") as HTMLInputElement).value,
    ).toBe("alex@example.com");
  });

  it("routes unknown-platform payloads through the shared fill engine instead of returning empty", () => {
    document.body.innerHTML = `
      <input id="candidate-email" aria-label="Email" />
    `;
    const detection = detectApplicationForm(document.body, "careers.acme.example");
    expect(detection.platform).toBe("unknown");

    const payload: AutofillPayload = {
      jd_id: "jd-generic",
      platform: "unknown",
      fields: [{ key: "email", selector: "", value: "sam@example.com" }],
    };

    const result = fillForPayload(payload, detection.fieldCandidates, document.body);

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]?.status).toBe("filled_needs_review");
    expect((document.querySelector("#candidate-email") as HTMLInputElement).value).toBe(
      "sam@example.com",
    );
  });

  it("routes linkedin-platform payloads through the shared fill engine as well", () => {
    document.body.innerHTML = `
      <input id="li-email" aria-label="Email" />
    `;
    const payload: AutofillPayload = {
      jd_id: "jd-linkedin",
      platform: "linkedin",
      fields: [{ key: "email", selector: "#li-email", value: "lin@example.com" }],
    };

    const result = fillForPayload(payload, [], document.body);

    // linkedin selector map is an empty scaffold (slice 12 gate), so this falls
    // through to the payload selector and still resolves via the shared engine.
    expect(result.fields[0]?.status).toBe("filled_high_confidence");
    expect((document.querySelector("#li-email") as HTMLInputElement).value).toBe(
      "lin@example.com",
    );
  });
});
