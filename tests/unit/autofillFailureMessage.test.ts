import { describe, expect, it } from "vitest";
import { autofillFailureMessage } from "../../content/autofill/controller.js";

describe("autofillFailureMessage", () => {
  it("asks the user to sign in when not authenticated", () => {
    expect(autofillFailureMessage({ code: "not_authenticated" })).toContain("Sign in");
  });

  it("explains missing saved jobs", () => {
    expect(autofillFailureMessage({ code: "not_found" })).toContain("Save the job");
  });

  it("surfaces network failures", () => {
    expect(autofillFailureMessage({ code: "network" })).toContain("Could not reach");
  });

  it("uses a generic message for unknown failures", () => {
    expect(autofillFailureMessage({ error: "Server busy" })).toContain(
      "Autofill is unavailable",
    );
  });
});
