/** Shared JD parsing helpers (service worker + content script). */

export const JD_MIN_LENGTH = 200;
export const JD_MAX_CHARS = 10_000;

const JD_KEYWORDS = [
  "responsibilities", "requirements", "qualifications", "experience",
  "skills", "you will", "we are looking", "job summary", "bachelor",
  "minimum", "proficiency", "collaborate", "develop", "design", "build",
];

const AGGREGATOR_END_MARKERS = [
  /\bHidden Jobs\b/i,
  /\bCustomize Your Resume\b/i,
  /\bBoost Your Interview\b/i,
  /\bAI ToolsCustomize\b/i,
  /\bCompany data provided by crunchbase\b/i,
];

const AGGREGATOR_START_MARKERS = [
  /\bOriginal Job Post\b/i,
  /\bOverviewCompany\b/i,
  /\b[A-Z][\w&™.,'()-]+ is (?:a|an|the) \b/i,
  /\bResponsibilities\b/i,
  /\bQualification\b/i,
];

export interface ParsedJD {
  title: string;
  company: string;
  text: string;
}

export function sanitizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = htmlNodeToPlainText(doc.body);
  return text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

function htmlNodeToPlainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\s+/g, " ");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") return "\n";

  const inner = Array.from(el.childNodes).map(htmlNodeToPlainText).join("").trim();

  if (tag === "li") return inner ? `\n- ${inner}` : "";
  if (tag === "p" || tag === "div") return inner ? `\n\n${inner}` : "";
  if (/^h[1-6]$/.test(tag)) return inner ? `\n\n${inner}\n\n` : "";
  if (tag === "ul" || tag === "ol") return inner ? `\n${inner}\n` : "";

  return inner;
}

/** Remove Jobright / aggregator boilerplate from JSON-LD descriptions. */
function polishStructuredJdText(text: string): string {
  return text
    .replace(/^Note:\s*The job is a remote job[^.\n]*\.\s*/i, "")
    .replace(/^Note:\s*[^.\n]+\.\s*/i, "")
    .replace(/^\s*Skills\s*$/gim, "Required Qualifications:")
    .replace(/^\s*Skills:\s*$/gim, "Required Qualifications:")
    .replace(/\bRequired Qualifications\b(?!:)/g, "Required Qualifications:")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\bCompany Overview\b/i, "Company")
    .trim();
}

function normalizeJobTitle(title: string): string {
  return sanitizeText(title.replace(/^\[[^\]]+\]\s*/, ""));
}

interface JobrightJobResult {
  jobTitle?: string;
  jobLocation?: string;
  isRemote?: boolean;
  workModel?: string;
  salaryDesc?: string;
  employmentType?: string;
  jobSeniority?: string;
  minYearsOfExperience?: number;
  jobSummary?: string;
  recommendationTags?: string[];
  jdCoreSkills?: Array<{ skill?: string }>;
  companyResult?: { companyCategories?: string; companyName?: string };
}

interface JobrightDetailPayload {
  jobResult?: JobrightJobResult;
  companyResult?: { companyCategories?: string; companyName?: string };
}

function parseJobrightDetailFromHtml(html: string): JobrightJobResult | null {
  const pattern =
    /<script[^>]*id=["']jobright-helper-job-detail-info["'][^>]*>([\s\S]*?)<\/script>/i;
  const match = pattern.exec(html);
  if (!match?.[1]) return null;
  try {
    const data = JSON.parse(match[1]) as JobrightDetailPayload;
    const jobResult = data.jobResult;
    if (!jobResult) return null;
    const companyResult = jobResult.companyResult ?? data.companyResult;
    return companyResult
      ? { ...jobResult, companyResult }
      : { ...jobResult };
  } catch {
    return null;
  }
}

function buildJobrightHeader(
  job: JobrightJobResult,
  title: string,
  company: string,
  includeSummary: boolean,
): string {
  const lines: string[] = [];
  const roleTitle = normalizeJobTitle(title || job.jobTitle || "Untitled Role");
  lines.push(roleTitle);

  const meta: string[] = [];
  if (company) meta.push(company);
  if (job.jobLocation) meta.push(job.jobLocation);
  if (job.workModel) meta.push(job.workModel);
  else if (job.isRemote) meta.push("Remote");
  if (job.employmentType) meta.push(job.employmentType);
  if (job.jobSeniority) meta.push(job.jobSeniority);
  if (meta.length > 1) lines.push(meta.join(" | "));

  const details: string[] = [];
  if (job.salaryDesc) details.push(`Salary: ${job.salaryDesc}`);
  if (typeof job.minYearsOfExperience === "number" && job.minYearsOfExperience > 0) {
    details.push(`Experience: ${job.minYearsOfExperience}+ years`);
  }
  if (details.length) lines.push(details.join(" | "));

  if (includeSummary && job.jobSummary?.trim()) {
    lines.push("", job.jobSummary.trim());
  }

  const industry = job.companyResult?.companyCategories?.trim();
  if (industry) lines.push("", `Industry: ${industry}`);

  if (job.recommendationTags?.length) {
    lines.push(`Tags: ${job.recommendationTags.join(", ")}`);
  }

  const skills = (job.jdCoreSkills ?? [])
    .map((s) => s.skill?.trim())
    .filter((s): s is string => Boolean(s));
  if (skills.length) {
    lines.push("", `Technologies: ${skills.join(", ")}`);
  }

  return lines.join("\n").trim();
}

function enrichWithJobrightDetail(parsed: ParsedJD, html: string): ParsedJD {
  const job = parseJobrightDetailFromHtml(html);
  if (!job) return parsed;

  const summary = job.jobSummary?.trim() ?? "";
  const bodyHasSummary =
    summary.length > 40 &&
    parsed.text.includes(summary.slice(0, Math.min(80, summary.length)));

  const header = buildJobrightHeader(
    job,
    parsed.title || job.jobTitle || "",
    parsed.company || job.companyResult?.companyName || "",
    !bodyHasSummary,
  );

  if (!header) return parsed;

  const titleLine = header.split("\n")[0]?.trim();
  const finalizedBody = finalizeJdText(parsed.text);
  if (titleLine && finalizedBody.startsWith(titleLine)) {
    return { ...parsed, text: finalizedBody };
  }

  const combined = `${header}\n\n${finalizedBody}`.trim();
  return {
    ...parsed,
    title: normalizeJobTitle(parsed.title || job.jobTitle || ""),
    company: parsed.company || job.companyResult?.companyName || "",
    text: truncateJdText(combined),
  };
}

export function formatJdSections(text: string): string {
  return text
    .replace(
      /\s*(Job Summary:|Responsibilities and Accountabilities:|Essential Responsibilities:|Minimum Qualifications:|Preferred Qualifications:|Required Qualifications:|Qualifications:|Qualification:|Required:|Benefits:|Company Overview:|Company:|Technologies:|(?<!(?:Core |Key |Required )?)Skills:|Responsibilities:)/gi,
      "\n\n$1",
    )
    .replace(
      /(\n|^)(Responsibilities|Qualification|Qualifications|Benefits|Required)(\n|$)/gi,
      "\n\n$2:\n",
    )
    .replace(/(\n|^)(?<!(?:Core |Key |Required )?)Skills(\n|$)/gi, "\n\nSkills:\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** MyGreenhouse search/dashboard chrome mixed into a job detail capture. */
export function isMyGreenhouseAggregatorNoise(text: string): boolean {
  if (/HomeProfileApplications/i.test(text)) return true;
  if (/Profile checklist/i.test(text) && /Drop your resume/i.test(text)) return true;
  if (/Dream Job/i.test(text) && /Recommended Roles/i.test(text)) return true;
  if (/Your job alerts/i.test(text) && /Search smarter, apply faster/i.test(text)) return true;
  return false;
}

/** Job boards (Jobright, etc.) embed nav chrome and a sidebar job feed in the DOM. */
export function isJobAggregatorNoise(text: string): boolean {
  if (isMyGreenhouseAggregatorNoise(text)) return true;
  if (/Apply with Autofill/i.test(text) && /GOOD MATCH/i.test(text)) return true;
  if (/ASK ORION/i.test(text)) return true;
  if (/Upgrade to Turbo/i.test(text)) return true;
  if (/Hidden Jobs/i.test(text)) return true;
  if (/JobsResumeProfile|JobsProfileAgent/i.test(text)) return true;
  if (/Insider Connection @/i.test(text)) return true;
  if ((text.match(/Why this job is a match/gi) ?? []).length >= 2) return true;
  if ((text.match(/GOOD MATCH|STRONG MATCH/gi) ?? []).length >= 2) return true;
  if (/Find More Connections/i.test(text) && /Recommended/i.test(text)) return true;
  return false;
}

/** Trim job-board nav chrome and sidebar recommendation feed from extracted text. */
export function stripJobAggregatorNoise(text: string): string {
  let cleaned = sanitizeText(text);
  if (!isJobAggregatorNoise(cleaned)) return cleaned;

  for (const marker of AGGREGATOR_END_MARKERS) {
    const idx = cleaned.search(marker);
    if (idx > 200) {
      cleaned = cleaned.slice(0, idx).trim();
      break;
    }
  }

  const feedIdx = cleaned.search(/\bRecommended\b.{0,120}\bWhy this job is a match\b/i);
  if (feedIdx > 1000) cleaned = cleaned.slice(0, feedIdx).trim();

  for (const marker of AGGREGATOR_START_MARKERS) {
    const match = marker.exec(cleaned);
    if (match && match.index > 0 && match.index < cleaned.length * 0.45) {
      cleaned = cleaned.slice(match.index).trim();
      break;
    }
  }

  return formatJdSections(cleaned);
}

/** Cap JD length for Smart Resume (10k). Prefer cutting before trailing sections. */
export function truncateJdText(text: string, max = JD_MAX_CHARS): string {
  if (text.length <= max) return text;
  const tailSections = [
    "Recent News",
    "Leadership Team",
    "Funding",
    "Company",
    "Benefits",
  ];
  for (const section of tailSections) {
    const re = new RegExp(`\\b${section}\\b`, "i");
    const window = text.slice(Math.floor(max * 0.65), max + 800);
    const match = re.exec(window);
    if (match) {
      const idx = Math.floor(max * 0.65) + match.index;
      if (idx >= max * 0.7 && idx <= max + 200) return text.slice(0, idx).trim();
    }
  }
  return text.slice(0, max).trim();
}

export function finalizeJdText(text: string): string {
  return truncateJdText(polishStructuredJdText(stripJobAggregatorNoise(cleanJdText(text))));
}

/** Strip HTML tags when boards-api or DOM capture returns markup. */
export function finalizeJdTextFromMaybeHtml(text: string): string {
  const input = /<[a-z][\s\S]*>/i.test(text) ? stripHtml(text) : text;
  return finalizeJdText(input);
}

export function cleanJdText(text: string): string {
  let cleaned = sanitizeText(text);
  const noisy =
    isMetadataHeavy(cleaned) ||
    cleaned.includes("Skip to main content") ||
    (cleaned.match(/custom_fields\./g) ?? []).length >= 1;

  const bodyMarkers = [
    /Job Summary:/i,
    /Job Description:/i,
    /Position Summary:/i,
    /About the Role:/i,
    /Responsibilities and Accountabilities:/i,
    /Responsibilities:/i,
  ];

  let earliestMarker = -1;
  for (const marker of bodyMarkers) {
    const match = marker.exec(cleaned);
    if (match && (earliestMarker < 0 || match.index < earliestMarker)) {
      earliestMarker = match.index;
    }
  }

  if (earliestMarker > 0) {
    const before = cleaned.slice(0, earliestMarker).trim();
    const keepPreamble =
      before.length >= 60 &&
      !isMetadataHeavy(before) &&
      !isJobAggregatorNoise(before);
    if (!keepPreamble && (noisy || earliestMarker < cleaned.length * 0.6)) {
      cleaned = cleaned.slice(earliestMarker).trim();
    }
  }

  if ((cleaned.match(/custom_fields\./g) ?? []).length >= 3) {
    const summaryIdx = cleaned.search(/Job Summary:/i);
    if (summaryIdx >= 0) cleaned = cleaned.slice(summaryIdx).trim();
    else return "";
  }

  return formatJdSections(cleaned);
}

export function isMetadataHeavy(text: string): boolean {
  if (isJobAggregatorNoise(text)) return true;
  if ((text.match(/custom_fields\./g) ?? []).length >= 3) return true;
  if (text.includes("Skip to main content") && text.includes("Talent Network")) return true;
  if (text.includes("Search by Keyword") && text.includes("Search by Location")) return true;
  const words = text.split(/\s+/);
  if (words.length === 0) return false;
  return words.filter((w) => w.includes("-")).length / words.length > 0.35;
}

function isJobPostingType(entry: Record<string, unknown>): boolean {
  const type = entry["@type"];
  if (type === "JobPosting") return true;
  if (Array.isArray(type) && type.includes("JobPosting")) return true;
  return false;
}

function parseJsonLdJobPosting(rawJson: string): ParsedJD | null {
  try {
    const data = JSON.parse(rawJson) as Record<string, unknown>;
    const entries: unknown[] = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const job = entry as Record<string, unknown>;
      if (!isJobPostingType(job)) continue;

      const rawHtml = String(job.description ?? "");
      const description = finalizeJdText(stripHtml(rawHtml));
      if (description.length < JD_MIN_LENGTH) continue;

      const org =
        typeof job.hiringOrganization === "object" && job.hiringOrganization !== null
          ? String((job.hiringOrganization as Record<string, unknown>).name ?? "")
          : "";

      return {
        title: normalizeJobTitle(String(job.title ?? "")),
        company: sanitizeText(org),
        text: description,
      };
    }
  } catch {
    // malformed JSON-LD
  }
  return null;
}

const UKG_OPPORTUNITY_MARKER = "new US.Opportunity.CandidateOpportunityDetail(";

/** UKG Pro Recruiting job boards (*.ukg.net, recruiting.ultipro.com). */
export function isUkgRecruitingHost(urlOrHost: string): boolean {
  try {
    const host = urlOrHost.includes("://")
      ? new URL(urlOrHost).hostname.toLowerCase()
      : urlOrHost.toLowerCase();
    return (
      host.endsWith(".ukg.net") ||
      host === "ukg.net" ||
      host.endsWith(".ultipro.com") ||
      host === "recruiting.ultipro.com"
    );
  } catch {
    return false;
  }
}

function extractBalancedJsonObject(source: string, openBraceIndex: number): string | null {
  if (openBraceIndex < 0 || source[openBraceIndex] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openBraceIndex, i + 1);
    }
  }

  return null;
}

function parseUkgOpportunityPayload(payload: string): ParsedJD | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    try {
      const cleaned = payload.replace(/,\s*([}\]])/g, "$1");
      data = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const description = finalizeJdText(stripHtml(String(data.Description ?? "")));
  if (description.length < JD_MIN_LENGTH) return null;

  return {
    title: normalizeJobTitle(String(data.Title ?? "")),
    company: "",
    text: description,
  };
}

function extractUkgCompanyFromHtml(html: string): string {
  const logoAlt = html.match(
    /data-automation=["']navbar-(?:small|large)-logo["'][^>]*alt=["']([^"']+)["']/i,
  );
  if (logoAlt?.[1]) return sanitizeText(logoAlt[1]);

  const altFirst = html.match(
    /alt=["']([^"']+)["'][^>]*data-automation=["']navbar-(?:small|large)-logo["']/i,
  );
  if (altFirst?.[1]) return sanitizeText(altFirst[1]);

  return "";
}

/** UKG embeds the posting inside `new US.Opportunity.CandidateOpportunityDetail({...})`. */
export function extractUkgOpportunityFromHtml(html: string): ParsedJD | null {
  const markerIndex = html.indexOf(UKG_OPPORTUNITY_MARKER);
  if (markerIndex < 0) return null;

  const openBraceIndex = html.indexOf("{", markerIndex + UKG_OPPORTUNITY_MARKER.length);
  const payload = extractBalancedJsonObject(html, openBraceIndex);
  if (!payload) return null;

  const parsed = parseUkgOpportunityPayload(payload);
  if (!parsed) return null;

  parsed.company = extractUkgCompanyFromHtml(html);
  return parsed;
}

export function extractJobPostingFromHtml(html: string): ParsedJD | null {
  if (isUkgRecruitingHost(html) || html.includes(UKG_OPPORTUNITY_MARKER)) {
    const ukgParsed = extractUkgOpportunityFromHtml(html);
    if (ukgParsed) return ukgParsed;
  }

  let parsed: ParsedJD | null = null;

  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      parsed = parseJsonLdJobPosting(script.textContent ?? "");
      if (parsed) break;
    }
  }

  if (!parsed) {
    const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      parsed = parseJsonLdJobPosting(match[1] ?? "");
      if (parsed) break;
    }
  }

  if (parsed) {
    parsed = enrichWithJobrightDetail(parsed, html);
  }

  return parsed;
}

export function scoreJdText(text: string): number {
  if (!text || text.length < JD_MIN_LENGTH) return -1;
  let score = 0;
  if (/^Job Summary:/i.test(text)) score += 200;
  else if (/Job Summary:/i.test(text)) score += 100;
  if (/^Responsibilities and Accountabilities:/i.test(text) && !/Job Summary:/i.test(text)) {
    score -= 80;
  }
  if (isJobAggregatorNoise(text)) score -= 600;
  if (isMetadataHeavy(text)) score -= 500;
  if (text.length > 8_000) score -= 150;
  if (text.length > JD_MAX_CHARS) score -= 300;
  const lower = text.toLowerCase();
  score += JD_KEYWORDS.filter((kw) => lower.includes(kw)).length * 5;
  score += Math.min(text.length / 100, 50);
  return score;
}

export function pickBetterJd(a: ParsedJD | null, b: ParsedJD | null): ParsedJD | null {
  if (!a) return b;
  if (!b) return a;

  const aNoise = isJobAggregatorNoise(a.text);
  const bNoise = isJobAggregatorNoise(b.text);
  if (aNoise && !bNoise) return { ...b, text: finalizeJdText(b.text) };
  if (bNoise && !aNoise) return { ...a, text: finalizeJdText(a.text) };

  const aText = finalizeJdText(a.text);
  const bText = finalizeJdText(b.text);
  const scoreA = scoreJdText(aText);
  const scoreB = scoreJdText(bText);
  const winner = scoreA >= scoreB ? { ...a, text: aText } : { ...b, text: bText };
  return winner;
}
