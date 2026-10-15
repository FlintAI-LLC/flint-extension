import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { resolveAutofillSurface } from "../../content/autofill/surface-root.js";

const WORKDAY_STEP = `
<form>
  <input data-automation-id="legalNameSection_firstName" aria-label="First Name" />
  <input data-automation-id="legalNameSection_lastName" aria-label="Last Name" />
  <input data-automation-id="addressSection_addressLine1" aria-label="Address Line 1" />
  <input data-automation-id="addressSection_city" aria-label="City" />
  <select data-automation-id="addressSection_countryRegion"><option>United States</option></select>
</form>
`;

function loadHtml(html: string): Document {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  return dom.window.document;
}

describe("resolveAutofillSurface", () => {
  it("finds a Workday form inside a same-origin iframe when the top frame is empty", () => {
    const inner = loadHtml(WORKDAY_STEP);
    const outer = loadHtml(`<iframe id="apply" src="about:blank"></iframe>`);
    const iframe = outer.getElementById("apply") as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentDocument", {
      value: inner,
      configurable: true,
    });

    const surface = resolveAutofillSurface(outer, "workday.wd5.myworkdayjobs.com");
    expect(surface).not.toBeNull();
    expect(surface?.detection.isApplicationForm).toBe(true);
    expect(surface?.root).toBe(inner.body);
  });

  it("returns null when neither top frame nor iframes look like an application", () => {
    const doc = loadHtml("<main><p>Loading…</p></main>");
    expect(resolveAutofillSurface(doc, "workday.wd5.myworkdayjobs.com")).toBeNull();
  });
});
