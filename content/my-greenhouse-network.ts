/**
 * Runs in the page MAIN world at document_start so we can observe MyGreenhouse's
 * own boards-api / Inertia fetches before jd-extractor runs at document_idle.
 */
(function installMyGreenhouseNetworkCache(): void {
  if (window.location.hostname.toLowerCase() !== "my.greenhouse.io") return;
  if ((window as Window & { __flintMyGhNetworkHook?: boolean }).__flintMyGhNetworkHook) return;
  (window as Window & { __flintMyGhNetworkHook?: boolean }).__flintMyGhNetworkHook = true;

  const CACHE_KEY = "flint_my_greenhouse_boards_job_v2";

  function stripHtml(html: string): string {
    const div = document.createElement("div");
    div.innerHTML = html;
    return (div.textContent ?? "").trim();
  }

  function readJobFromRecord(record: Record<string, unknown>): {
    title: string;
    company: string;
    text: string;
    absoluteUrl: string;
  } | null {
    const title =
      typeof record.title === "string"
        ? record.title.trim()
        : typeof record.job_title === "string"
          ? record.job_title.trim()
          : "";
    const company =
      typeof record.company_name === "string"
        ? record.company_name.trim()
        : typeof record.company === "string"
          ? record.company.trim()
          : "";
    const raw =
      typeof record.content === "string"
        ? record.content
        : typeof record.description === "string"
          ? record.description
          : "";
    const text = raw.includes("<") ? stripHtml(raw) : raw.trim();
    if (!title || text.length < 200) return null;

    const absoluteUrl =
      typeof record.absolute_url === "string" ? record.absolute_url : window.location.href;

    return { title, company, text, absoluteUrl };
  }

  function walkForJob(payload: unknown, depth = 0): {
    title: string;
    company: string;
    text: string;
    absoluteUrl: string;
  } | null {
    if (depth > 12 || payload === null || payload === undefined) return null;

    if (Array.isArray(payload)) {
      for (const item of payload) {
        const found = walkForJob(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    if (typeof payload !== "object") return null;

    const record = payload as Record<string, unknown>;
    const direct = readJobFromRecord(record);
    if (direct) return direct;

    for (const value of Object.values(record)) {
      const found = walkForJob(value, depth + 1);
      if (found) return found;
    }

    return null;
  }

  function parseBoardJobRef(url: string): { boardToken: string; jobId: string } | null {
    const match = url.match(
      /boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs\/(\d+)/i,
    );
    if (!match) return null;
    return { boardToken: match[1], jobId: match[2] };
  }

  function maybeCacheJobPayload(url: string, payload: unknown): void {
    const job = walkForJob(payload);
    if (!job) return;
    if (!url.includes("boards-api.greenhouse.io") && !url.includes("my.greenhouse.io")) return;

    const ref = parseBoardJobRef(url);
    if (!ref) return;

    try {
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          ts: Date.now(),
          boardToken: ref.boardToken,
          jobId: ref.jobId,
          job,
        }),
      );
    } catch {
      // sessionStorage unavailable.
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const request = args[0];
    const url =
      typeof request === "string"
        ? request
        : request instanceof Request
          ? request.url
          : String(request);
    const response = await originalFetch(...args);
    const shouldInspect =
      (url.includes("boards-api.greenhouse.io") && url.includes("/jobs")) ||
      (url.includes("my.greenhouse.io") && /\/jobs/i.test(url));

    if (shouldInspect) {
      try {
        const clone = response.clone();
        void clone
          .json()
          .then((json) => maybeCacheJobPayload(url, json))
          .catch(() => {
            // Not JSON — ignore.
          });
      } catch {
        // Ignore hook failures.
      }
    }
    return response;
  };
})();
