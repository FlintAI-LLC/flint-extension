import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutofillOverlay } from "../../content/autofill/overlay.js";
import type { FillResult } from "../../content/autofill/types.js";

const PAGE_URL = "https://boards.greenhouse.io/example/jobs/123";

function mountTestForm(): void {
  document.body.innerHTML = `
    <form>
      <input name="job_application[email]" id="email" value="" />
    </form>
  `;
}

describe("AutofillOverlay", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mountTestForm();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows offer state and confirms autofill", () => {
    const onAutofillConfirm = vi.fn();
    const overlay = new AutofillOverlay(
      {
        onAutofillConfirm,
        onSessionPick: vi.fn(),
        onDismiss: vi.fn(),
      },
      PAGE_URL,
    );

    overlay.mount();
    overlay.showOffer({ title: "Senior Engineer", company: "Example Co" }, "jd-1");

    expect(overlay.getView()).toBe("offer");
    const autofillButton = overlay["shadow"]!.querySelector(".btn-primary") as HTMLButtonElement;
    autofillButton.click();
    expect(onAutofillConfirm).toHaveBeenCalledWith("jd-1");
  });

  it("transitions to result state with review rows and jump-to-field", () => {
    const overlay = new AutofillOverlay(
      {
        onAutofillConfirm: vi.fn(),
        onSessionPick: vi.fn(),
        onDismiss: vi.fn(),
      },
      PAGE_URL,
    );

    const result: FillResult = {
      percent_filled: 75,
      fields: [
        {
          key: "email",
          selector: "[name='job_application[email]']",
          status: "filled_needs_review",
          value_preview: "alex@example.com",
        },
        {
          key: "resume",
          selector: "[name='job_application[resume]']",
          status: "not_applicable_file_upload",
        },
      ],
    };

    overlay.mount();
    overlay.showResult(result);

    expect(overlay.getView()).toBe("result");
    expect(overlay["shadow"]!.textContent).toContain("75% filled");
    expect(overlay["shadow"]!.textContent).toContain("Attach manually");

    const jumpButton = Array.from(overlay["shadow"]!.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Jump to field"),
    ) as HTMLButtonElement;
    jumpButton.click();

    const emailInput = document.querySelector("[name='job_application[email]']") as HTMLElement;
    expect(document.activeElement).toBe(emailInput);
  });

  it("shows picker state and forwards session selection", () => {
    const onSessionPick = vi.fn();
    const overlay = new AutofillOverlay(
      {
        onAutofillConfirm: vi.fn(),
        onSessionPick,
        onDismiss: vi.fn(),
      },
      PAGE_URL,
    );

    overlay.mount();
    overlay.showPicker([
      { jd_id: "jd-a", title: "Backend Engineer", company: "Acme" },
      { jd_id: "jd-b", title: "Platform Engineer", company: "Beta" },
    ]);

    expect(overlay.getView()).toBe("picker");
    const pickButtons = overlay["shadow"]!.querySelectorAll(".picker-item");
    expect(pickButtons).toHaveLength(2);
    (pickButtons[0] as HTMLButtonElement).click();
    expect(onSessionPick).toHaveBeenCalledWith("jd-a");
  });

  it("persists dismiss per tab via sessionStorage", () => {
    const onDismiss = vi.fn();
    const overlay = new AutofillOverlay(
      {
        onAutofillConfirm: vi.fn(),
        onSessionPick: vi.fn(),
        onDismiss,
      },
      PAGE_URL,
    );

    overlay.mount();
    overlay.showOffer({ title: "Senior Engineer", company: "Example Co" }, "jd-1");

    const dismissButton = overlay["shadow"]!.querySelector(".btn-secondary") as HTMLButtonElement;
    dismissButton.click();

    expect(onDismiss).toHaveBeenCalled();
    expect(overlay.getView()).toBe("hidden");
    expect(overlay.isDismissedForPage()).toBe(true);

    overlay.showOffer({ title: "Senior Engineer", company: "Example Co" }, "jd-1");
    expect(overlay.getView()).toBe("hidden");
  });
});
