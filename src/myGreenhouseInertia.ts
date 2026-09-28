import { finalizeJdText, JD_MIN_LENGTH } from "./jdParse.js";
import { jobFromBoardsApiPayload } from "./greenhouseBoardsApi.js";
import { forEachElementIncludingShadow } from "./shadowDomWalk.js";

export interface MyGreenhouseInertiaJob {
  title: string;
  company: string;
  text: string;
  boardToken?: string;
  jobId?: string;
}

function stripHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").trim();
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function nodeLooksLikeJob(record: Record<string, unknown>): boolean {
  const title = readString(record, ["title", "job_title", "name"]);
  if (!title) return false;

  const content = readString(record, ["content", "description", "body", "job_description"]);
  if (content.length >= JD_MIN_LENGTH) return true;

  const boardToken = readString(record, [
    "board_token",
    "board_slug",
    "board",
    "for",
    "company_slug",
  ]);
  const jobId = readString(record, [
    "job_id",
    "greenhouse_job_id",
    "gh_jid",
    "external_job_id",
    "posting_id",
    "id",
  ]);

  return Boolean(boardToken && jobId && jobId.length >= 5);
}

function jobFromInertiaNode(record: Record<string, unknown>): MyGreenhouseInertiaJob | null {
  const title = readString(record, ["title", "job_title", "name"]);
  if (!title) return null;

  const company = readString(record, [
    "company_name",
    "company",
    "organization_name",
    "employer_name",
  ]);

  const rawContent = readString(record, ["content", "description", "body", "job_description"]);
  const text = rawContent.includes("<")
    ? finalizeJdText(stripHtml(rawContent))
    : finalizeJdText(rawContent);

  const boardToken = readString(record, [
    "board_token",
    "board_slug",
    "board",
    "for",
    "company_slug",
  ]);
  const jobId = readString(record, [
    "job_id",
    "greenhouse_job_id",
    "gh_jid",
    "external_job_id",
    "posting_id",
  ]);

  if (text.length >= JD_MIN_LENGTH) {
    return { title, company, text, boardToken, jobId };
  }

  if (boardToken && jobId) {
    return { title, company, text: "", boardToken, jobId };
  }

  const apiParsed = jobFromBoardsApiPayload(record);
  if (apiParsed) {
    return {
      title: apiParsed.title,
      company: apiParsed.company,
      text: apiParsed.text,
      boardToken,
      jobId,
    };
  }

  return null;
}

function walkForJobNode(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 14 || value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkForJobNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (nodeLooksLikeJob(record)) return record;

  for (const child of Object.values(record)) {
    const found = walkForJobNode(child, depth + 1);
    if (found) return found;
  }

  return null;
}

function parseInertiaJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function extractJobFromInertiaPage(doc: Document): MyGreenhouseInertiaJob | null {
  const pageHosts: Element[] = [];
  forEachElementIncludingShadow(doc, (el) => {
    if (el.hasAttribute("data-page")) pageHosts.push(el);
  });
  if (pageHosts.length === 0 && doc.querySelector("#app")) {
    pageHosts.push(doc.querySelector("#app")!);
  }
  for (const host of pageHosts) {
    const raw = host.getAttribute("data-page");
    if (!raw) continue;
    const page = parseInertiaJson(raw);
    const node = walkForJobNode(page);
    if (!node) continue;
    const job = jobFromInertiaNode(node);
    if (job) return job;
  }

  for (const script of doc.querySelectorAll("script[type='application/json']")) {
    const job = jobFromInertiaNode(walkForJobNode(parseInertiaJson(script.textContent ?? "")) ?? {});
    if (job) return job;
  }

  return null;
}
