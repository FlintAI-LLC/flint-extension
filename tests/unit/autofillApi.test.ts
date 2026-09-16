import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAutofillPayload } from "../../src/autofillApi.js";

describe("fetchAutofillPayload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps HTTP 409 to not_tailored (resume_not_tailored_yet)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 409,
        ok: false,
        json: async () => ({ detail: { code: "resume_not_tailored_yet" } }),
      }),
    );

    const result = await fetchAutofillPayload("jd-1", "token");

    expect(result).toEqual({ ok: false, code: "not_tailored" });
  });
});
