import { finalizeJdText, isMyGreenhouseAggregatorNoise } from "./jdParse.js";

const MIN_JD_LENGTH = 200;

/** Posted · 36 minutes ago, Posted today, Posted 1 hour ago, etc. */
const POSTED_PATTERN =
  /Posted\s*(?:[·•]\s*)?(?:\d+\s*(?:minute|hour|day|week)s?\s+ago|today|yesterday|\d+\s+\w+\s+ago)/i;

const JOB_BODY_SIGNALS = [
  /Who you are/i,
  /What you get to do/i,
  /What you bring to the role/i,
  /Responsibilities/i,
  /Qualifications/i,
  /Requirements/i,
  /you will/i,
  /we are looking/i,
];

export function isMyGreenhouseHost(hostname: string): boolean {
  return hostname.toLowerCase() === "my.greenhouse.io";
}

export function isMyGreenhouseBrandName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^my\s*greenhouse$/i.test(trimmed) || /^greenhouse$/i.test(trimmed);
}

function elementText(el: Element): string {
  const htmlEl = el as HTMLElement;
  return (htmlEl.innerText ?? el.textContent ?? "").trim();
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 80) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
}

function jobSignalCount(text: string): number {
  return JOB_BODY_SIGNALS.filter((pattern) => pattern.test(text)).length;
}

/**
 * MyGreenhouse uses a split flex layout: job list on the left, open posting in a
 * right-hand pane (no navigation). Prefer visible panels on the right half.
 */
export function findMyGreenhouseDetailPanel(doc: Document): Element | null {
  const viewportWidth = window.innerWidth || doc.documentElement.clientWidth || 1200;
  const candidates: Element[] = [];

  for (const el of doc.querySelectorAll(
    "main div, main article, main section, [role='main'] div, #app div, [class*='job'] div, [class*='Job'] div",
  )) {
    if (!isVisible(el)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.left < viewportWidth * 0.22) continue;
    if (rect.width < viewportWidth * 0.22) continue;

    const text = elementText(el);
    if (text.length < 300 || text.length > 25_000) continue;
    if (/HomeProfileApplications|Dream Job/i.test(text.slice(0, 220))) continue;
    if (jobSignalCount(text) < 1 && !POSTED_PATTERN.test(text)) continue;

    candidates.push(el);
  }

  candidates.sort((a, b) => elementText(a).length - elementText(b).length);
  return candidates[0] ?? null;
}

export function extractTitleCompanyFromPanel(root: Element): { title: string; company: string } {
  const rejectName = (value: string) =>
    isMyGreenhouseBrandName(value) || /^(jobs?|search|home|profile)$/i.test(value.trim());

  const headings = Array.from(root.querySelectorAll("h1, h2, h3"))
    .map((node) => elementText(node))
    .filter((text) => text.length > 2 && !rejectName(text));

  let title = headings[0] ?? "";
  let company = headings[1] ?? "";

  for (const sel of [
    "[data-testid='job-title']",
    "[class*='job-title']",
    "[class*='JobTitle']",
  ]) {
    const el = root.querySelector(sel);
    const text = el ? elementText(el) : "";
    if (text && !rejectName(text)) {
      title = text;
      break;
    }
  }

  for (const sel of [
    "[data-testid='company-name']",
    "[class*='company-name']",
    "[class*='CompanyName']",
  ]) {
    const el = root.querySelector(sel);
    const text = el ? elementText(el) : "";
    if (text && !rejectName(text)) {
      company = text;
      break;
    }
  }

  if (!company && title) {
    const lines = elementText(root)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const titleIdx = lines.findIndex((line) => line === title);
    if (titleIdx >= 0) {
      for (let i = titleIdx + 1; i < Math.min(titleIdx + 4, lines.length); i++) {
        const line = lines[i];
        if (/^(Remote|Hybrid|On[- ]site|Posted)/i.test(line)) break;
        if (line && !rejectName(line)) {
          company = line;
          break;
        }
      }
    }
  }

  if (rejectName(company)) company = "";
  if (rejectName(title)) title = "";

  return { title, company };
}

function parseMyGreenhouseHeader(lines: string[]): { title: string; company: string } {
  if (lines.length < 2) return { title: "", company: "" };

  let locationIdx = lines.length - 1;
  while (locationIdx >= 0 && !/^(Remote|Hybrid|On[- ]site)$/i.test(lines[locationIdx])) {
    locationIdx -= 1;
  }
  if (locationIdx < 1) return { title: "", company: "" };

  const company = lines[locationIdx - 1] ?? "";
  const title = lines[locationIdx - 2] ?? lines[0] ?? "";
  return {
    title: isMyGreenhouseBrandName(title) ? "" : title,
    company: isMyGreenhouseBrandName(company) ? "" : company,
  };
}

export function parseMyGreenhouseJobText(
  raw: string,
): { title: string; company: string; text: string } | null {
  const postedIdx = raw.search(POSTED_PATTERN);
  const hasPosted = postedIdx >= 0;

  let text = raw;
  const endMarkers = [
    /Profile checklist/i,
    /Drop your resume or browse to autofill/i,
    /Your job alerts/i,
    /This site uses cookies/i,
    /Recommended Roles/i,
    /Active applications/i,
    /Find the right role and make it your Dream Job/i,
    /Search smarter, apply faster/i,
  ];
  for (const marker of endMarkers) {
    const idx = text.search(marker);
    if (idx > 400) {
      text = text.slice(0, idx).trim();
      break;
    }
  }

  let title = "";
  let company = "";
  if (hasPosted) {
    const headerLines = text
      .slice(0, postedIdx)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    ({ title, company } = parseMyGreenhouseHeader(headerLines));
  }

  let body = "";
  if (hasPosted) {
    body = text
      .slice(postedIdx)
      .replace(/^Posted\s*(?:[·•]\s*)?[\w\s]+(?:ago|today|yesterday)\s*/i, "")
      .trim();
  } else if (jobSignalCount(text) >= 2) {
    body = text.trim();
  }

  if (body.length < MIN_JD_LENGTH) return null;
  if (isMyGreenhouseAggregatorNoise(body)) return null;

  return {
    title,
    company,
    text: finalizeJdText(body),
  };
}

export function extractMyGreenhouseFromDocument(
  doc: Document,
): { title: string; company: string; text: string } | null {
  const panel = findMyGreenhouseDetailPanel(doc);
  if (panel) {
    const { title: domTitle, company: domCompany } = extractTitleCompanyFromPanel(panel);
    const parsed = parseMyGreenhouseJobText(elementText(panel));
    if (parsed && parsed.text.length >= MIN_JD_LENGTH) {
      return {
        title: domTitle || parsed.title,
        company: domCompany || parsed.company,
        text: parsed.text,
      };
    }

    const fallbackBody = finalizeJdText(elementText(panel));
    if (fallbackBody.length >= MIN_JD_LENGTH && !isMyGreenhouseAggregatorNoise(fallbackBody)) {
      return {
        title: domTitle,
        company: domCompany,
        text: fallbackBody,
      };
    }
  }

  const candidates = Array.from(doc.querySelectorAll("main, article, section, div"));
  let best: { title: string; company: string; text: string } | null = null;
  let bestLen = Infinity;

  for (const el of candidates) {
    const raw = elementText(el);
    if (!POSTED_PATTERN.test(raw) && jobSignalCount(raw) < 2) continue;
    if (/HomeProfileApplications|Dream Job/i.test(raw.slice(0, 160))) continue;
    if (raw.length < MIN_JD_LENGTH || raw.length > 30_000) continue;
    const parsed = parseMyGreenhouseJobText(raw);
    if (!parsed || parsed.text.length < MIN_JD_LENGTH) continue;
    const domMeta = extractTitleCompanyFromPanel(el);
    const merged = {
      title: domMeta.title || parsed.title,
      company: domMeta.company || parsed.company,
      text: parsed.text,
    };
    if (parsed.text.length < bestLen) {
      best = merged;
      bestLen = parsed.text.length;
    }
  }

  return best;
}

export function sanitizeMyGreenhouseExtractedFields(
  title: string,
  company: string,
): { title: string; company: string } {
  return {
    title: isMyGreenhouseBrandName(title) ? "" : title.trim(),
    company: isMyGreenhouseBrandName(company) ? "" : company.trim(),
  };
}
