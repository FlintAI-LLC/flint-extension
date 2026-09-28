import { describe, expect, it } from "vitest";
import { extractJobFromInertiaPage } from "../../src/myGreenhouseInertia.js";

describe("myGreenhouseInertia", () => {
  it("reads job title, company, and description from Inertia data-page", () => {
    const page = {
      component: "Jobs/Show",
      props: {
        job: {
          title: "Sr Software Engineer",
          company_name: "AlertMedia",
          board_token: "alertmedia",
          job_id: "8661716002",
          content:
            "<p>Do work that matters.</p><p>At AlertMedia we help organizations stay safe.</p>" +
            "<p>Who you are: collaborative engineer.</p><p>What you get to do: build APIs.</p>" +
            "<p>What you bring: 6+ years of experience building scalable web applications with strong communication skills.</p>",
        },
      },
    };

    const doc = new DOMParser().parseFromString('<div id="app"></div>', "text/html");
    doc.querySelector("#app")?.setAttribute("data-page", JSON.stringify(page));
    const job = extractJobFromInertiaPage(doc);

    expect(job?.title).toBe("Sr Software Engineer");
    expect(job?.company).toBe("AlertMedia");
    expect(job?.boardToken).toBe("alertmedia");
    expect(job?.text).toContain("At AlertMedia we help organizations stay safe");
  });
});
