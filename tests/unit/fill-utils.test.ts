import { describe, expect, it } from "vitest";
import { querySelectorDeep } from "../../content/autofill/fill-utils.js";

describe("querySelectorDeep", () => {
  it("finds inputs inside open shadow roots", () => {
    const doc = document.implementation.createHTMLDocument("shadow");
    const host = doc.createElement("div");
    doc.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<input name="job_application[email]" type="email" />`;

    const found = querySelectorDeep(doc, "[name='job_application[email]']");
    expect(found).not.toBeNull();
    expect((found as HTMLInputElement).type).toBe("email");
  });
});
