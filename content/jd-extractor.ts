import type { ExtractedJD, FetchPageHtmlResult, PopupMessage } from "../src/types.js";
import {
  extractUkgOpportunityFromHtml,
  finalizeJdText,
  isMetadataHeavy,
  isUkgRecruitingHost,
} from "../src/jdParse.js";
import { resolveLinkedInJobFetchUrl } from "../src/linkedinJobUrl.js";
import selectorsConfig from "./jd-selectors.json";

const HEURISTIC_MIN_LENGTH = 200;
const EXTRACTION_TIMEOUT_MS = 5000;

const GENERIC_DESCRIPTION_SELECTORS = [
  ".job-description",
  ".ats-description",
  "#job-description",
  "[data-testid='job-description']",
  "[class*='jobDescription']",
  "[id*='job-description']",
];

const JD_KEYWORDS = [
  "responsibilities", "requirements", "qualifications", "experience",
  "skills", "you will", "we are looking", "we're looking", "you'll",
  "you have", "must have", "nice to have", "preferred", "bachelor",
  "minimum", "proficiency", "collaborate", "develop", "design",
  "build", "maintain", "communicate", "mentor", "lead", "manage",
  "deploy", "engineer", "analyst", "manager", "position", "role",
  "team", "salary", "compensation", "benefits", "pto", "vacation",
];

interface SiteSelectors {
  matches: string[];
  title: string[];
  company: string[];
  description: string[];
}

type SelectorsConfig = typeof selectorsConfig;

function queryFirst(selectors: string[]): string {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = (el.textContent ?? "").trim();
      if (text) return text;
      if (el instanceof HTMLImageElement && el.alt.trim()) return el.alt.trim();
    } catch {
      // Ignore invalid selectors.
    }
  }
  return "";
}

function detectSite(config: SelectorsConfig): SiteSelectors | null {
  const host = window.location.hostname;
  const path = window.location.pathname;
  for (const site of Object.values(config)) {
    for (const pattern of site.matches) {
      if (host.includes(pattern) || path.includes(pattern)) return site;
    }
  }
  return null;
}

function sanitizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function isJobPostingType(entry: Record<string, unknown>): boolean {
  const type = entry["@type"];
  if (type === "JobPosting") return true;
  if (Array.isArray(type) && type.includes("JobPosting")) return true;
  return false;
}

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? div.innerText ?? html;
}

function parseJsonLdJobPosting(
  rawJson: string,
): { title: string; company: string; text: string } | null {
  try {
    const data = JSON.parse(rawJson);
    const entries: unknown[] = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const job = entry as Record<string, unknown>;
      if (!isJobPostingType(job)) continue;

      const description = finalizeJdText(stripHtml(String(job["description"] ?? "")));
      if (description.length < HEURISTIC_MIN_LENGTH) continue;

      const orgName =
        typeof job["hiringOrganization"] === "object" && job["hiringOrganization"] !== null
          ? String((job["hiringOrganization"] as Record<string, unknown>)["name"] ?? "")
          : "";

      return {
        title: sanitizeText(String(job["title"] ?? "")),
        company: sanitizeText(orgName),
        text: description,
      };
    }
  } catch {
    // Malformed JSON-LD — skip.
  }
  return null;
}

function extractFromJsonLdInDocument(
  doc: Document,
): { title: string; company: string; text: string } | null {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    const result = parseJsonLdJobPosting(script.textContent ?? "");
    if (result) return result;
  }
  return null;
}

function extractFromJsonLdInHtmlString(
  html: string,
): { title: string; company: string; text: string } | null {
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const result = parseJsonLdJobPosting(match[1] ?? "");
    if (result) return result;
  }
  return null;
}

async function fetchPageHtmlViaServiceWorker(url: string): Promise<string | null> {
  try {
    const result = (await chrome.runtime.sendMessage({
      type: "FETCH_PAGE_HTML",
      url,
    })) as FetchPageHtmlResult;
    if ("html" in result && result.html) return result.html;
    return null;
  } catch {
    return null;
  }
}

/**
 * Some SPAs strip JSON-LD from the live DOM after hydration. The background
 * service worker re-fetches the public HTML (requires host_permissions).
 */
async function extractFromJsonLdWithFetchFallback(): Promise<{
  title: string;
  company: string;
  text: string;
} | null> {
  const live = extractFromJsonLdInDocument(document);
  if (live) return live;

  const html = await fetchPageHtmlViaServiceWorker(
    resolveLinkedInJobFetchUrl(document.location.href),
  );
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const fromDoc = extractFromJsonLdInDocument(doc);
  if (fromDoc) return fromDoc;

  return extractFromJsonLdInHtmlString(html);
}

/** Smallest DOM subtree that contains "Job Summary:" and enough body text. */
function extractFromDomJobSummaryBlock(): string {
  const candidates = Array.from(
    document.querySelectorAll(
      "div, section, article, main, [class*='description'], [id*='description']",
    ),
  );

  let best = "";
  let bestLen = Infinity;

  for (const el of candidates) {
    const raw = el.textContent ?? "";
    if (!/Job Summary:/i.test(raw)) continue;
    if (isMetadataHeavy(raw)) continue;

    const text = finalizeJdText(raw);
    if (text.length < HEURISTIC_MIN_LENGTH) continue;
    if (!/^Job Summary:/i.test(text)) continue;

    if (text.length < bestLen) {
      bestLen = text.length;
      best = text;
    }
  }

  return best;
}

function extractFromGenericSelectors(): string {
  for (const sel of GENERIC_DESCRIPTION_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = finalizeJdText(el.textContent ?? "");
      if (text.length >= HEURISTIC_MIN_LENGTH && !isMetadataHeavy(text)) {
        return text;
      }
    } catch {
      // Ignore invalid selectors.
    }
  }
  return "";
}

function jdKeywordScore(text: string): number {
  const lower = text.toLowerCase();
  const hits = JD_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  return hits / JD_KEYWORDS.length;
}

function extractScoredHeuristic(): string {
  const candidates = Array.from(
    document.querySelectorAll(
      "p, div, section, article, main, [class*='description'], [id*='description']",
    ),
  );

  let best = "";
  let bestScore = -1;

  for (const el of candidates) {
    if (el.children.length > 30) continue;

    const raw = el.textContent ?? "";
    if (isMetadataHeavy(raw)) continue;

    const text = finalizeJdText(raw);
    if (text.length < HEURISTIC_MIN_LENGTH) continue;

    const kwScore = jdKeywordScore(text);
    const lengthFactor = Math.min(text.length / 5000, 1);
    const score = kwScore * 0.7 + lengthFactor * 0.3;

    if (score > bestScore) {
      bestScore = score;
      best = text;
    }
  }

  return best;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Extraction timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function isKnownSpaHost(): boolean {
  // These SPAs never have JSON-LD in their server-rendered HTML — skip the
  // expensive SW fetch and go straight to DOM selectors.
  const host = window.location.hostname;
  return (
    host.includes("linkedin.com") ||
    host.includes("myworkdayjobs.com") ||
    host.includes("greenhouse.io") ||
    isUkgRecruitingHost(host)
  );
}

function extractFromUkgEmbeddedScript(): { title: string; company: string; text: string } | null {
  if (!document.documentElement.outerHTML.includes("CandidateOpportunityDetail")) return null;
  return extractUkgOpportunityFromHtml(document.documentElement.outerHTML);
}

async function _extractJDInner(): Promise<ExtractedJD> {
  const config: SelectorsConfig = selectorsConfig;

  if (isUkgRecruitingHost(window.location.href)) {
    const embedded = extractFromUkgEmbeddedScript();
    if (embedded && embedded.text.length >= HEURISTIC_MIN_LENGTH) {
      return {
        title: embedded.title || document.title,
        company: embedded.company,
        text: embedded.text,
        url: window.location.href,
        extraction_method: "structured",
      };
    }
  }

  // --- Layer 1 (SPA-aware): known-site DOM selectors run first for SPAs ---
  // For SPA-based ATSes the DOM is already rendered; going to DOM selectors
  // immediately avoids a 2-3s SW network fetch that always comes back empty.
  if (isKnownSpaHost()) {
    const site = detectSite(config);
    if (site) {
      const title = sanitizeText(queryFirst(site.title));
      const company = sanitizeText(queryFirst(site.company));
      const text = finalizeJdText(queryFirst(site.description));
      if (text.length >= HEURISTIC_MIN_LENGTH && !isMetadataHeavy(text)) {
        return {
          title: title || document.title,
          company,
          text,
          url: window.location.href,
          extraction_method: "structured",
        };
      }
    }
    // Fall through to JSON-LD check (live DOM only, no SW fetch for SPAs).
    const liveLd = extractFromJsonLdInDocument(document);
    if (liveLd && liveLd.text.length >= HEURISTIC_MIN_LENGTH) {
      return {
        title: liveLd.title || document.title,
        company: liveLd.company,
        text: liveLd.text,
        url: window.location.href,
        extraction_method: "structured",
      };
    }
  } else {
    // --- Layer 1: JSON-LD JobPosting (live DOM → SW fetch → regex) ---
    const jsonLd = await extractFromJsonLdWithFetchFallback();
    if (jsonLd && jsonLd.text.length >= HEURISTIC_MIN_LENGTH) {
      return {
        title: jsonLd.title || document.title,
        company: jsonLd.company,
        text: jsonLd.text,
        url: window.location.href,
        extraction_method: "structured",
      };
    }
  }

  // --- Layer 2: DOM block containing "Job Summary:" (iCIMS/Kaiser live DOM) ---
  const summaryBlock = extractFromDomJobSummaryBlock();
  if (summaryBlock.length >= HEURISTIC_MIN_LENGTH) {
    return {
      title: document.title,
      company: "",
      text: summaryBlock,
      url: window.location.href,
      extraction_method: "structured",
    };
  }

  // --- Layer 3: Known-site structured selectors (non-SPA hosts reach here) ---
  const site = detectSite(config);
  if (site) {
    const title = sanitizeText(queryFirst(site.title));
    const company = sanitizeText(queryFirst(site.company));
    const text = finalizeJdText(queryFirst(site.description));
    if (
      text.length >= HEURISTIC_MIN_LENGTH &&
      !isMetadataHeavy(text) &&
      !(/^Responsibilities/i.test(text) && !/Job Summary:/i.test(text))
    ) {
      return {
        title: title || document.title,
        company,
        text,
        url: window.location.href,
        extraction_method: "structured",
      };
    }
  }

  // --- Layer 4: Generic ATS description containers ---
  const genericText = extractFromGenericSelectors();
  if (genericText.length >= HEURISTIC_MIN_LENGTH) {
    return {
      title: document.title,
      company: "",
      text: genericText,
      url: window.location.href,
      extraction_method: "structured",
    };
  }

  // --- Layer 5: Keyword-scored heuristic ---
  const heuristicText = extractScoredHeuristic();
  return {
    title: document.title,
    company: "",
    text: heuristicText,
    url: window.location.href,
    extraction_method: "heuristic",
  };
}

function extractJD(): Promise<ExtractedJD> {
  return withTimeout(_extractJDInner(), EXTRACTION_TIMEOUT_MS);
}

chrome.runtime.onMessage.addListener(
  (message: PopupMessage, _sender, sendResponse) => {
    if (message.type !== "EXTRACT_JD") return false;

    extractJD()
      .then((jd) => {
        sendResponse({ type: "JD_RESULT", jd } as PopupMessage);
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : "Extraction failed";
        sendResponse({ type: "JD_ERROR", error } as PopupMessage);
      });

    return true;
  },
);
