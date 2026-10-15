import { forEachElementIncludingShadow } from "../../src/shadowDomWalk.js";
import selectorsConfig from "./selectors.json";

/** Minimum confidence before the overlay should offer autofill. */
export const APPLICATION_FORM_CONFIDENCE_THRESHOLD = 0.55;

export type Platform =
  | "greenhouse"
  | "linkedin"
  | "lever"
  | "ashby"
  | "workday"
  | "unknown";

export type FieldConcept =
  | "name"
  | "email"
  | "phone"
  | "resume"
  | "cover_letter"
  | "linkedin_url"
  | "work_authorization"
  | "eeo"
  | "address_line1"
  | "city"
  | "state"
  | "postal_code"
  | "country"
  | "source_of_hire"
  | "prior_employment";

export interface FieldCandidate {
  concept: FieldConcept;
  confidence: number;
  matchSource: "selector_map" | "heuristic";
  /** Best-effort selector for downstream fill + jump-to-field. */
  selector: string;
}

export interface DetectionResult {
  isApplicationForm: boolean;
  confidence: number;
  platform: Platform;
  fieldCandidates: FieldCandidate[];
}

const FIELD_CONCEPT_SIGNALS: Record<FieldConcept, readonly string[]> = {
  name: ["name", "full name", "first name", "last name", "legal name", "given name", "family name"],
  email: ["email", "e-mail", "email address"],
  phone: ["phone", "mobile", "telephone", "cell"],
  resume: ["resume", "cv", "curriculum vitae", "résumé"],
  cover_letter: ["cover letter", "coverletter", "motivation letter"],
  linkedin_url: ["linkedin", "linkedin profile", "linkedin url"],
  work_authorization: [
    "work authorization",
    "work authorisation",
    "authorized to work",
    "authorised to work",
    "visa",
    "sponsorship",
    "legally authorized",
  ],
  eeo: [
    "gender",
    "race",
    "ethnicity",
    "veteran",
    "disability",
    "eeo",
    "equal employment",
    "demographic",
  ],
  address_line1: ["address", "address line 1", "street address", "addressline1"],
  city: ["city", "town"],
  state: ["state", "province", "state province", "region"],
  postal_code: ["postal code", "zip", "zip code", "postcode", "postalcode"],
  country: ["country", "country territory"],
  source_of_hire: ["how did you hear about us", "source", "referral source", "how did you hear"],
  prior_employment: ["previously worked", "former employee", "currently working for"],
};

/**
 * Per-concept contribution to the detection score.
 *
 * The address/geo/referral concepts are deliberately weak: they are common on
 * generic "Contact us" forms, so on an unrecognised host they must not be able
 * to push a page over the threshold on their own. On a known ATS host the
 * `isKnownAtsSurface` predicate carries the decision instead.
 */
const WEAK_CONCEPT_WEIGHT = 0.04;
const DEFAULT_CONCEPT_WEIGHT = 0.12;
/**
 * Combined ceiling for weak concepts, deliberately below one strong concept.
 * Without it, a "Contact us" form carrying address + city + state + zip +
 * country stacks five weak matches and crosses the threshold on its own.
 */
const WEAK_CONCEPT_TOTAL_CAP = 0.06;
const WEAK_CONCEPTS: ReadonlySet<FieldConcept> = new Set<FieldConcept>([
  "address_line1",
  "city",
  "state",
  "postal_code",
  "country",
  "source_of_hire",
  "prior_employment",
]);

/** Known-ATS pages need more than a search box and a filter to count as a form. */
const KNOWN_ATS_MIN_INPUTS = 4;
/**
 * A known-ATS page must also look like it collects personal details, or the
 * predicate would fire on login pages, job-search filter bars and candidate
 * dashboards — all of which live on the same hosts and carry
 * `data-automation-id`. Requiring one identity field plus breadth keeps a
 * two-field login (email + password) out.
 */
const KNOWN_ATS_MIN_CONCEPTS = 3;
const STRONG_IDENTITY_CONCEPTS: ReadonlySet<FieldConcept> = new Set<FieldConcept>([
  "name",
  "email",
  "phone",
]);

const INPUT_SELECTOR = "input:not([type='hidden']), textarea, select";

interface SelectorsFile {
  greenhouse: { host_patterns: string[]; fields: Array<{ key: string; selector: string }> };
  linkedin: { host_patterns: string[]; fields: Array<{ key: string; selector: string }> };
}

function normalizeSignal(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostMatchesPattern(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase();
  const pat = pattern.toLowerCase();
  if (pat.startsWith("*.")) {
    const suffix = pat.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === pat;
}

export function detectPlatformFromHost(hostname: string): Platform {
  const host = hostname.toLowerCase();
  const config = selectorsConfig as SelectorsFile;
  if (config.greenhouse.host_patterns.some((p) => hostMatchesPattern(hostname, p))) {
    return "greenhouse";
  }
  if (config.linkedin.host_patterns.some((p) => hostMatchesPattern(hostname, p))) {
    return "linkedin";
  }
  if (host === "myworkdayjobs.com" || host.endsWith(".myworkdayjobs.com")) {
    return "workday";
  }
  if (host === "myworkday.com" || host.endsWith(".myworkday.com")) {
    return "workday";
  }
  return "unknown";
}

function elementMatchesInputSelector(el: Element): boolean {
  try {
    return el.matches(INPUT_SELECTOR);
  } catch {
    return false;
  }
}

export function collectInputElements(root: ParentNode): Element[] {
  const inputs: Element[] = [];
  if (root instanceof Document) {
    forEachElementIncludingShadow(root, (el) => {
      if (elementMatchesInputSelector(el)) inputs.push(el);
    });
    return inputs;
  }
  if (root instanceof Element) {
    forEachElementIncludingShadow(root, (el) => {
      if (elementMatchesInputSelector(el)) inputs.push(el);
    });
    return inputs;
  }
  return Array.from(root.querySelectorAll(INPUT_SELECTOR));
}

function countInputElements(root: ParentNode): number {
  return collectInputElements(root).length;
}

interface FieldSignal {
  /** Human-visible text: label, aria-label, placeholder. */
  label: string;
  /** Internal identifiers: id, name, autocomplete, data-automation-id. */
  attrs: string;
}

function collectSignalText(el: Element): FieldSignal {
  const labelParts: string[] = [];
  const attrParts: string[] = [];
  const htmlEl = el as HTMLElement;

  if (htmlEl.id) attrParts.push(htmlEl.id);
  if (htmlEl.getAttribute("name")) attrParts.push(htmlEl.getAttribute("name") ?? "");
  if (htmlEl.getAttribute("autocomplete")) attrParts.push(htmlEl.getAttribute("autocomplete") ?? "");
  // Workday identifies its controls with data-automation-id, not name/id.
  if (htmlEl.getAttribute("data-automation-id")) {
    attrParts.push(htmlEl.getAttribute("data-automation-id") ?? "");
  }

  if (htmlEl.getAttribute("placeholder")) labelParts.push(htmlEl.getAttribute("placeholder") ?? "");
  if (htmlEl.getAttribute("aria-label")) labelParts.push(htmlEl.getAttribute("aria-label") ?? "");

  // Look labels up in the element's own tree. `ownerDocument` does not pierce
  // shadow boundaries, so for a shadowed Workday input every label[for] and
  // aria-labelledby lookup silently missed.
  const rootNode = htmlEl.getRootNode();
  const labelScope: ParentNode =
    rootNode instanceof ShadowRoot || rootNode instanceof Document
      ? rootNode
      : htmlEl.ownerDocument;

  const labelledBy = htmlEl.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const labelEl = labelScope.querySelector(`#${escapeCssIdent(id)}`);
      if (labelEl?.textContent) labelParts.push(labelEl.textContent);
    }
  }

  const id = htmlEl.id;
  if (id) {
    const forLabel = labelScope.querySelector(`label[for="${escapeAttrValue(id)}"]`);
    if (forLabel?.textContent) labelParts.push(forLabel.textContent);
  }

  const parentLabel = htmlEl.closest("label");
  if (parentLabel?.textContent) labelParts.push(parentLabel.textContent);

  return {
    label: normalizeSignal(labelParts.join(" ")),
    attrs: normalizeSignal(attrParts.join(" ")),
  };
}

function longestKeywordMatch(signal: string): FieldConcept | null {
  if (!signal) return null;
  let best: { concept: FieldConcept; score: number } | null = null;
  for (const [concept, keywords] of Object.entries(FIELD_CONCEPT_SIGNALS) as Array<
    [FieldConcept, readonly string[]]
  >) {
    for (const keyword of keywords) {
      if (signal.includes(keyword)) {
        const score = keyword.length;
        if (!best || score > best.score) best = { concept, score };
      }
    }
  }
  return best?.concept ?? null;
}

function matchConcept(signal: FieldSignal, inputType: string): FieldConcept | null {
  if (inputType === "file") return "resume";
  // Visible label text wins over internal identifiers: Workday names its city
  // input `addressSection_city`, which otherwise matches "address" and steals
  // the street-address concept.
  return longestKeywordMatch(signal.label) ?? longestKeywordMatch(signal.attrs);
}

function escapeCssIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function buildElementSelector(el: Element): string {
  const htmlEl = el as HTMLElement;
  const name = htmlEl.getAttribute("name");
  if (name) return `[name="${escapeAttrValue(name)}"]`;
  if (htmlEl.id) return `#${escapeCssIdent(htmlEl.id)}`;
  const tag = htmlEl.tagName.toLowerCase();
  const parent = htmlEl.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter((c) => c.tagName === htmlEl.tagName);
  const index = siblings.indexOf(htmlEl);
  return `${tag}:nth-of-type(${index + 1})`;
}

/** Maps AutofillFieldPayload/selector-map keys to detector concepts. Shared with fill-engine. */
export const FIELD_KEY_TO_CONCEPT: Record<string, FieldConcept> = {
  first_name: "name",
  last_name: "name",
  email: "email",
  phone: "phone",
  resume: "resume",
  cover_letter: "cover_letter",
  linkedin_url: "linkedin_url",
  work_authorization: "work_authorization",
};

function selectorKeyToConcept(key: string): FieldConcept | null {
  return FIELD_KEY_TO_CONCEPT[key] ?? null;
}

function selectorMapMatch(
  el: Element,
  platform: Platform,
): { concept: FieldConcept; selector: string } | null {
  if (platform === "unknown") return null;
  const config = selectorsConfig as SelectorsFile;
  const fields = platform === "greenhouse" ? config.greenhouse.fields : config.linkedin.fields;
  for (const field of fields) {
    try {
      if (el.matches(field.selector)) {
        const concept = selectorKeyToConcept(field.key);
        if (!concept) continue;
        return { concept, selector: field.selector };
      }
    } catch {
      // Invalid selector in JSON — skip.
    }
  }
  return null;
}

function hasGreenhouseApplicationNaming(root: ParentNode): boolean {
  return Boolean(root.querySelector("[name^='job_application']"));
}

function scoreDetection(
  fieldCandidates: FieldCandidate[],
  platform: Platform,
  hasFormShell: boolean,
  greenhouseNaming: boolean,
): number {
  let score = 0;
  if (hasFormShell) score += 0.15;
  const uniqueConcepts = new Set(fieldCandidates.map((c) => c.concept));
  let strongScore = 0;
  let weakScore = 0;
  for (const concept of uniqueConcepts) {
    if (WEAK_CONCEPTS.has(concept)) weakScore += WEAK_CONCEPT_WEIGHT;
    else strongScore += DEFAULT_CONCEPT_WEIGHT;
  }
  score += Math.min(strongScore + Math.min(weakScore, WEAK_CONCEPT_TOTAL_CAP), 0.72);
  if (platform !== "unknown") score += 0.2;
  if (greenhouseNaming) score += 0.15;
  return Math.min(score, 1);
}

/**
 * True when a recognised ATS host is showing something structurally like an
 * application step.
 *
 * Needed because the concept scorer is built around identity fields, so a
 * Workday "My Information" step — mostly address and geo selects — scored 0.47
 * against a 0.55 threshold and never offered. Scoped to known hosts so generic
 * forms elsewhere still have to earn the threshold.
 */
export function isKnownAtsSurface(
  root: ParentNode,
  hostname: string,
  fieldCandidates: readonly FieldCandidate[],
): boolean {
  const platform = hostname ? detectPlatformFromHost(hostname) : "unknown";
  if (platform === "unknown") return false;
  if (countInputElements(root) < KNOWN_ATS_MIN_INPUTS) return false;
  if (!root.querySelector("form") && !root.querySelector("[data-automation-id]")) return false;

  const concepts = new Set(fieldCandidates.map((c) => c.concept));
  if (concepts.size < KNOWN_ATS_MIN_CONCEPTS) return false;
  return [...concepts].some((concept) => STRONG_IDENTITY_CONCEPTS.has(concept));
}

export function detectApplicationForm(root: ParentNode, hostname = ""): DetectionResult {
  const platform = hostname ? detectPlatformFromHost(hostname) : "unknown";
  const fieldCandidates: FieldCandidate[] = [];
  const seenConcepts = new Set<FieldConcept>();

  for (const el of collectInputElements(root)) {
    const inputType = (el as HTMLInputElement).type?.toLowerCase() ?? "";
    const mapped = selectorMapMatch(el, platform);
    if (mapped && !seenConcepts.has(mapped.concept)) {
      seenConcepts.add(mapped.concept);
      fieldCandidates.push({
        concept: mapped.concept,
        confidence: 0.95,
        matchSource: "selector_map",
        selector: mapped.selector,
      });
      continue;
    }

    const signal = collectSignalText(el);
    const concept = matchConcept(signal, inputType);
    if (!concept || seenConcepts.has(concept)) continue;

    seenConcepts.add(concept);
    fieldCandidates.push({
      concept,
      confidence: inputType === "file" ? 0.9 : 0.75,
      matchSource: "heuristic",
      selector: buildElementSelector(el),
    });
  }

  const hasFormShell = Boolean(root.querySelector("form")) || countInputElements(root) >= 2;
  const greenhouseNaming = platform === "greenhouse" && hasGreenhouseApplicationNaming(root);
  const confidence = scoreDetection(fieldCandidates, platform, hasFormShell, greenhouseNaming);

  return {
    isApplicationForm:
      confidence >= APPLICATION_FORM_CONFIDENCE_THRESHOLD ||
      isKnownAtsSurface(root, hostname, fieldCandidates),
    confidence,
    platform,
    fieldCandidates,
  };
}

export function observeApplicationForm(
  callback: (result: DetectionResult) => void,
  options?: { root?: ParentNode; debounceMs?: number; hostname?: string },
): () => void {
  const debounceMs = options?.debounceMs ?? 300;
  const root = options?.root ?? document;
  const hostname =
    options?.hostname ??
    (typeof globalThis.location !== "undefined" ? globalThis.location.hostname : "");

  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = (): void => {
    callback(detectApplicationForm(root, hostname));
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  };

  run();

  const observer = new MutationObserver(schedule);
  const observeTarget = root === document ? document.documentElement : root;
  observer.observe(observeTarget, { childList: true, subtree: true });

  return () => {
    if (timer) clearTimeout(timer);
    observer.disconnect();
  };
}
