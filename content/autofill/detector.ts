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
  | "eeo";

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
};

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
  const config = selectorsConfig as SelectorsFile;
  if (config.greenhouse.host_patterns.some((p) => hostMatchesPattern(hostname, p))) {
    return "greenhouse";
  }
  if (config.linkedin.host_patterns.some((p) => hostMatchesPattern(hostname, p))) {
    return "linkedin";
  }
  return "unknown";
}

function collectSignalText(el: Element): string {
  const parts: string[] = [];
  const htmlEl = el as HTMLElement;

  if (htmlEl.id) parts.push(htmlEl.id);
  if (htmlEl.getAttribute("name")) parts.push(htmlEl.getAttribute("name") ?? "");
  if (htmlEl.getAttribute("placeholder")) parts.push(htmlEl.getAttribute("placeholder") ?? "");
  if (htmlEl.getAttribute("aria-label")) parts.push(htmlEl.getAttribute("aria-label") ?? "");
  if (htmlEl.getAttribute("autocomplete")) parts.push(htmlEl.getAttribute("autocomplete") ?? "");

  const labelledBy = htmlEl.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const labelEl = htmlEl.ownerDocument.getElementById(id);
      if (labelEl?.textContent) parts.push(labelEl.textContent);
    }
  }

  const id = htmlEl.id;
  if (id) {
    const forLabel = htmlEl.ownerDocument.querySelector(
      `label[for="${escapeAttrValue(id)}"]`,
    );
    if (forLabel?.textContent) parts.push(forLabel.textContent);
  }

  const parentLabel = htmlEl.closest("label");
  if (parentLabel?.textContent) parts.push(parentLabel.textContent);

  return normalizeSignal(parts.join(" "));
}

function matchConcept(signal: string, inputType: string): FieldConcept | null {
  if (inputType === "file") return "resume";

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
  score += Math.min(uniqueConcepts.size * 0.12, 0.72);
  if (platform !== "unknown") score += 0.2;
  if (greenhouseNaming) score += 0.15;
  return Math.min(score, 1);
}

export function detectApplicationForm(root: ParentNode, hostname = ""): DetectionResult {
  const platform = hostname ? detectPlatformFromHost(hostname) : "unknown";
  const fieldCandidates: FieldCandidate[] = [];
  const seenConcepts = new Set<FieldConcept>();

  for (const el of Array.from(root.querySelectorAll(INPUT_SELECTOR))) {
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

  const hasFormShell =
    Boolean(root.querySelector("form")) ||
    root.querySelectorAll(INPUT_SELECTOR).length >= 2;
  const greenhouseNaming = platform === "greenhouse" && hasGreenhouseApplicationNaming(root);
  const confidence = scoreDetection(fieldCandidates, platform, hasFormShell, greenhouseNaming);

  return {
    isApplicationForm: confidence >= APPLICATION_FORM_CONFIDENCE_THRESHOLD,
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
