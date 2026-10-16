import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { highlightFieldAtSelector } from "../../content/autofill/field-highlight.js";

describe("highlightFieldAtSelector", () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    input = document.createElement("input");
    input.id = "target-field";
    document.body.appendChild(input);
  });

  afterEach(() => {
    input.remove();
  });

  it("scrolls the field into view, not just focuses it", () => {
    // Regression: "jump to field" previously only called focus({preventScroll:
    // true}) with no scroll at all, so an off-screen field never became
    // visible — indistinguishable from the button doing nothing.
    const scrollSpy = vi.fn();
    input.scrollIntoView = scrollSpy;
    const focusSpy = vi.spyOn(input, "focus");

    const result = highlightFieldAtSelector(document, "#target-field");

    expect(result).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain scrollIntoView() call if smooth options throw", () => {
    const scrollSpy = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("smooth scroll unsupported in this frame");
      })
      .mockImplementationOnce(() => undefined);
    input.scrollIntoView = scrollSpy;

    const result = highlightFieldAtSelector(document, "#target-field");

    expect(result).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });

  it("returns false and does not throw when the selector matches nothing", () => {
    expect(highlightFieldAtSelector(document, "#does-not-exist")).toBe(false);
  });
});
