import { beforeEach, describe, expect, it } from "vitest";
import {
  jobMatchesSelection,
  pickBestGreenhouseJobRef,
  readMyGreenhouseNetworkJobCache,
  writeMyGreenhouseNetworkJobCache,
} from "../../src/myGreenhouseBoardsApi.js";
import type { GreenhouseBoardJobRef } from "../../src/greenhouseBoardsApi.js";

const MINDBODY_CARD = `Sr Software Engineer
Mindbody
Remote
United States
Posted · 5 hours ago`;

describe("myGreenhouseBoardsApi", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Element.prototype.getBoundingClientRect = function () {
      const el = this as Element;
      if (el.classList.contains("apply-link")) {
        return {
          left: 500,
          width: 120,
          height: 40,
          top: 0,
          right: 620,
          bottom: 40,
          x: 500,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (el.classList.contains("job-list-item")) {
        return {
          left: 40,
          width: 280,
          height: 120,
          top: 0,
          right: 320,
          bottom: 120,
          x: 40,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        left: 360,
        width: 700,
        height: 900,
        top: 0,
        right: 1060,
        bottom: 900,
        x: 360,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    };
    window.getComputedStyle = () =>
      ({
        display: "block",
        visibility: "visible",
        opacity: "1",
      }) as CSSStyleDeclaration;
  });

  it("prefers the apply link in the right-hand detail pane", () => {
    const refs: GreenhouseBoardJobRef[] = [
      { boardToken: "takealot", jobId: "111", source: "list" },
      { boardToken: "mindbody", jobId: "222", source: "detail" },
    ];
    const html = `
      <div id="app">
        <div class="job-list-item selected" aria-selected="true">${MINDBODY_CARD}</div>
        <div class="job-panel">
          <a class="apply-link" href="https://job-boards.greenhouse.io/mindbody/jobs/222">Apply</a>
        </div>
      </div>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const best = pickBestGreenhouseJobRef(refs, doc, {
      title: "Sr Software Engineer",
      company: "Mindbody",
    });
    expect(best?.jobId).toBe("222");
  });

  it("rejects a boards-api job that does not match the visible selection", () => {
    expect(
      jobMatchesSelection(
        { title: "Staff Software Engineer", company: "Fluxon" },
        { title: "Sr Software Engineer", company: "Mindbody" },
      ),
    ).toBe(false);
    expect(
      jobMatchesSelection(
        { title: "Sr Software Engineer", company: "Mindbody" },
        { title: "Sr Software Engineer", company: "Mindbody" },
      ),
    ).toBe(true);
  });

  it("reads cache only for the matching board/job ref", () => {
    const job = {
      title: "Sr Software Engineer",
      company: "Mindbody",
      text: "x".repeat(220),
      absoluteUrl: "https://job-boards.greenhouse.io/mindbody/jobs/222",
    };
    writeMyGreenhouseNetworkJobCache(job, { boardToken: "mindbody", jobId: "222" });

    expect(readMyGreenhouseNetworkJobCache({ boardToken: "mindbody", jobId: "222" })?.company).toBe(
      "Mindbody",
    );
    expect(readMyGreenhouseNetworkJobCache({ boardToken: "acme", jobId: "999" })).toBeNull();
    expect(readMyGreenhouseNetworkJobCache()).toBeNull();
  });
});
