import { finalizeJdText, JD_MIN_LENGTH } from "./jdParse.js";
import { collectShadowDomTextSnippets, forEachElementIncludingShadow } from "./shadowDomWalk.js";

/** boards.greenhouse.io and job-boards.greenhouse.io job posting URLs. */
export const GREENHOUSE_BOARD_JOB_URL_RE =
  /(?:https?:\/\/)?(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/gi;

/** boards-api.greenhouse.io job resource URLs. */
export const GREENHOUSE_BOARD_API_JOB_URL_RE =
  /boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs\/(\d+)/gi;

export interface GreenhouseBoardJobRef {
  boardToken: string;
  jobId: string;
  source: string;
}

export function parseGreenhouseBoardJobUrl(url: string): GreenhouseBoardJobRef | null {
  const match =
    /(?:https?:\/\/)?(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i.exec(url);
  if (!match) return null;
  return {
    boardToken: match[1],
    jobId: match[2],
    source: url,
  };
}

export function parseGreenhouseBoardApiJobUrl(url: string): GreenhouseBoardJobRef | null {
  const match = /boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs\/(\d+)/i.exec(url);
  if (!match) return null;
  return {
    boardToken: match[1],
    jobId: match[2],
    source: url,
  };
}

/** MyGreenhouse embed iframe: embed/job_app?for=board&token=jobId */
export function parseGreenhouseEmbedJobUrl(url: string): GreenhouseBoardJobRef | null {
  const normalized = url.replace(/&amp;/g, "&");
  const forward =
    /embed\/job_app[^"'\\]*?(?:\?|&)for=([^&"'\\]+)[^"'\\]*?(?:\?|&)token=(\d+)/i.exec(
      normalized,
    );
  if (forward) {
    return {
      boardToken: forward[1],
      jobId: forward[2],
      source: url,
    };
  }

  const reverse =
    /embed\/job_app[^"'\\]*?(?:\?|&)token=(\d+)[^"'\\]*?(?:\?|&)for=([^&"'\\]+)/i.exec(
      normalized,
    );
  if (reverse) {
    return {
      boardToken: reverse[2],
      jobId: reverse[1],
      source: url,
    };
  }

  return null;
}

/** Scan inline HTML for paired board token + job id (embed widgets, gh_jid). */
export function collectEmbedRefsFromHtml(html: string, limit = 16): GreenhouseBoardJobRef[] {
  const seen = new Set<string>();
  const refs: GreenhouseBoardJobRef[] = [];
  const normalized = html.replace(/&amp;/g, "&");

  const push = (boardToken: string, jobId: string, source: string): void => {
    const key = `${boardToken}|${jobId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ boardToken, jobId, source });
  };

  const embedRe =
    /embed\/job_app[^"'\\]*?(?:\?|&)for=([^&"'\\]+)[^"'\\]*?(?:\?|&)token=(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = embedRe.exec(normalized)) !== null && refs.length < limit) {
    push(match[1], match[2], match[0]);
  }

  const ghJidRe = /gh_jid=(\d+)/gi;
  const forRe = /(?:\?|&)for=([a-z0-9_-]+)/gi;
  const jobIds: string[] = [];
  const boardTokens: string[] = [];
  while ((match = ghJidRe.exec(normalized)) !== null) {
    jobIds.push(match[1]);
  }
  while ((match = forRe.exec(normalized)) !== null) {
    if (!match[1].includes(".")) boardTokens.push(match[1]);
  }
  if (jobIds.length === 1 && boardTokens.length >= 1) {
    push(boardTokens[boardTokens.length - 1], jobIds[0], `gh_jid=${jobIds[0]}`);
  }

  return refs;
}

function stripHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").trim();
}

export function jobFromBoardsApiPayload(
  data: Record<string, unknown>,
): { title: string; company: string; text: string } | null {
  const rawContent = typeof data.content === "string" ? data.content : "";
  const text = finalizeJdText(stripHtml(rawContent));
  if (text.length < JD_MIN_LENGTH) return null;

  const title = typeof data.title === "string" ? data.title.trim() : "";
  const company =
    typeof data.company_name === "string"
      ? data.company_name.trim()
      : typeof data.company === "string"
        ? data.company.trim()
        : "";

  if (!title) return null;

  return { title, company, text };
}

export function boardsApiJobUrl(boardToken: string, jobId: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs/${encodeURIComponent(jobId)}?content=true`;
}

export function boardsApiJobsListUrl(boardToken: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
}

function refKey(ref: GreenhouseBoardJobRef): string {
  return `${ref.boardToken}|${ref.jobId}`;
}

/** Collect unique board/job ids from anchors, iframes, and inline HTML. */
export function collectGreenhouseBoardJobRefs(
  doc: Document,
  htmlScanLimit = 12,
): GreenhouseBoardJobRef[] {
  const seen = new Set<string>();
  const refs: GreenhouseBoardJobRef[] = [];

  const pushRef = (ref: GreenhouseBoardJobRef | null): void => {
    if (!ref) return;
    const key = refKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  forEachElementIncludingShadow(doc, (el) => {
    if (el instanceof HTMLAnchorElement && el.href) {
      pushRef(parseGreenhouseBoardJobUrl(el.href));
      pushRef(parseGreenhouseBoardApiJobUrl(el.href));
      pushRef(parseGreenhouseEmbedJobUrl(el.href));
    }
    if (el instanceof HTMLIFrameElement && el.src) {
      pushRef(parseGreenhouseBoardJobUrl(el.src));
      pushRef(parseGreenhouseBoardApiJobUrl(el.src));
      pushRef(parseGreenhouseEmbedJobUrl(el.src));
    }
  });

  const html = collectShadowDomTextSnippets(doc).join("\n");
  for (const ref of collectEmbedRefsFromHtml(html, htmlScanLimit)) {
    pushRef(ref);
  }
  let match: RegExpExecArray | null;
  const boardRe = new RegExp(GREENHOUSE_BOARD_JOB_URL_RE.source, "gi");
  while ((match = boardRe.exec(html)) !== null && refs.length < htmlScanLimit) {
    pushRef({
      boardToken: match[1],
      jobId: match[2],
      source: match[0],
    });
  }

  const apiRe = new RegExp(GREENHOUSE_BOARD_API_JOB_URL_RE.source, "gi");
  while ((match = apiRe.exec(html)) !== null && refs.length < htmlScanLimit) {
    pushRef({
      boardToken: match[1],
      jobId: match[2],
      source: match[0],
    });
  }

  return refs;
}
