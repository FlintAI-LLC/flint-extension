import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isApplicationComplete,
  observeApplicationSteps,
} from "../../content/autofill/continuation.js";
import { detectApplicationForm } from "../../content/autofill/detector.js";

describe("application continuation", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form id="step-1">
        <input name="job_application[first_name]" placeholder="First Name" />
        <input name="job_application[email]" type="email" placeholder="Email" />
      </form>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("detects completion copy on thank-you pages", () => {
    document.body.innerHTML = `<main><h1>Thank you for applying</h1></main>`;
    expect(isApplicationComplete(document.body, "boards.greenhouse.io")).toBe(true);
  });

  it("fires onStepChange when the form structure changes without a URL change", async () => {
    const onStepChange = vi.fn();

    const stop = observeApplicationSteps({
      root: document.body,
      hostname: "boards.greenhouse.io",
      debounceMs: 50,
      onStepChange,
    });

    document.body.innerHTML = `
      <form id="step-2">
        <input name="job_application[phone]" type="tel" placeholder="Phone" />
        <input name="job_application[linkedin]" placeholder="LinkedIn profile" />
        <input name="job_application[resume]" type="file" aria-label="Resume/CV" />
      </form>
    `;

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(onStepChange).toHaveBeenCalledTimes(1);
    expect(onStepChange.mock.calls[0]?.[0]?.reason).toBe("mutation");

    const detection = detectApplicationForm(document.body, "boards.greenhouse.io");
    expect(detection.isApplicationForm).toBe(true);

    stop();
  });

  it("does not report completion merely because a page is not a detected form", () => {
    // Regression guard: this used to return `!isApplicationForm`, so every
    // unrecognised page looked like a finished application and the controller
    // hid the overlay and dropped the active session on each mutation.
    document.body.innerHTML = `<main><h1>Loading your application</h1><p>Please wait.</p></main>`;

    const detection = detectApplicationForm(document.body, "boards.greenhouse.io");
    expect(detection.isApplicationForm).toBe(false);
    expect(isApplicationComplete(document.body, "boards.greenhouse.io")).toBe(false);
  });

  it("does not fire onApplicationComplete on an interstitial with no completion copy", async () => {
    const onApplicationComplete = vi.fn();

    const stop = observeApplicationSteps({
      root: document.body,
      hostname: "boards.greenhouse.io",
      debounceMs: 50,
      onStepChange: vi.fn(),
      onApplicationComplete,
    });

    document.body.innerHTML = `<main><h1>Loading next step</h1></main>`;
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(onApplicationComplete).not.toHaveBeenCalled();
    stop();
  });

  it("notices a step change inside an open shadow root", async () => {
    const onStepChange = vi.fn();
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<input id="s1" placeholder="First Name" />`;
    document.body.appendChild(host);

    const stop = observeApplicationSteps({
      root: document.body,
      hostname: "workday.wd5.myworkdayjobs.com",
      debounceMs: 50,
      onStepChange,
    });

    // Mutating the light DOM is what the observer sees; the signature must
    // reflect the shadow contents so the change is recognised as a new step.
    shadow.innerHTML = `
      <input id="s2" placeholder="Address Line 1" />
      <input id="s3" placeholder="City" />
    `;
    document.body.appendChild(document.createElement("span"));

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(onStepChange).toHaveBeenCalled();

    stop();
    host.remove();
  });

  it("fires onApplicationComplete when confirmation copy appears", async () => {
    const onApplicationComplete = vi.fn();

    const stop = observeApplicationSteps({
      root: document.body,
      hostname: "boards.greenhouse.io",
      debounceMs: 50,
      onStepChange: vi.fn(),
      onApplicationComplete,
    });

    document.body.innerHTML = `<main><h1>We've received your application</h1></main>`;
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(onApplicationComplete).toHaveBeenCalled();
    stop();
  });
});
