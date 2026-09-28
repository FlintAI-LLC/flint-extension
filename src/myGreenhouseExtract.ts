import { finalizeJdText, isMyGreenhouseAggregatorNoise } from "./jdParse.js";
import {
  clearListClickMyGreenhouseJobContext,
  readListClickMyGreenhouseJobContext,
  readRefMyGreenhouseJobContext,
} from "./myGreenhouseContext.js";
import { forEachElementIncludingShadow } from "./shadowDomWalk.js";

const LOCATION_LINE_RE =
  /^(Remote|Hybrid|On[- ]site|United States|Canada|United Kingdom|UK|USA|Europa?)$/i;

const CITY_STATE_RE = /^[A-Za-z .'-]+,\s*[A-Z]{2,3}(?:\s|$)/;

function looksLikeCityRegionLine(value: string): boolean {
  const match = /^([A-Za-z .'-]+),\s*([A-Za-z .'-]+)$/.exec(value.trim());
  if (!match) return false;
  const city = match[1];
  const region = match[2];
  if (!city || !region || city.length < 3 || region.length < 2 || region.length > 24) {
    return false;
  }
  if (
    /\b(engineer|manager|director|analyst|developer|senior|lead|software|product)\b/i.test(
      value,
    )
  ) {
    return false;
  }
  return true;
}

/** Recent list-click wins over a stale virtualized row; older clicks lose to aria-selected. */
const FRESH_LIST_CLICK_MS = 12_000;

export function looksLikeLocationMetadata(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (LOCATION_LINE_RE.test(trimmed)) return true;
  if (CITY_STATE_RE.test(trimmed)) return true;
  if (looksLikeCityRegionLine(trimmed)) return true;
  if (/^Posted\b/i.test(trimmed)) return true;
  return false;
}

export function isPlausibleJobHeader(title: string, company: string): boolean {
  const t = title.trim();
  const c = company.trim();
  if (!t || !c || t.length < 4 || c.length < 2) return false;
  if (looksLikeLocationMetadata(t) || looksLikeLocationMetadata(c)) return false;
  if (isMyGreenhouseBrandName(t) || isMyGreenhouseBrandName(c)) return false;
  if (/^(jobs?|search|home|profile)$/i.test(t) || /^(jobs?|search)$/i.test(c)) return false;
  return true;
}

export function detailPaneMatchesSelection(
  doc: Document,
  selected: { title: string; company: string },
): boolean {
  const panel = findMyGreenhouseDetailPanel(doc, selected);
  if (!panel) return false;
  const text = elementText(panel);
  return (
    textIncludesJobToken(text, selected.title) &&
    textIncludesJobToken(text, selected.company)
  );
}

function pickExtractTitleCompany(
  selected: { title: string; company: string } | null,
  panelMeta: { title: string; company: string },
): { title: string; company: string } {
  if (selected && isPlausibleJobHeader(selected.title, selected.company)) {
    return { title: selected.title, company: selected.company };
  }
  if (isPlausibleJobHeader(panelMeta.title, panelMeta.company)) {
    return panelMeta;
  }
  return {
    title: selected?.title?.trim() ?? "",
    company: selected?.company?.trim() ?? "",
  };
}

/** Read title + company from the right-hand detail pane headings (MyGreenhouse flex UI). */
export function findVisibleJobHeaderFromDetailPane(
  doc: Document,
): { title: string; company: string } | null {
  const viewportWidth = window.innerWidth || doc.documentElement.clientWidth || 1200;
  const bestHolder: { value: { title: string; company: string; score: number } | null } = {
    value: null,
  };

  forEachElementIncludingShadow(doc, (el) => {
    if (!/^H[1-3]$/i.test(el.tagName)) return;
    if (!isVisible(el)) return;

    const rect = el.getBoundingClientRect();
    if (rect.left < viewportWidth * 0.28) return;

    const title = elementText(el);
    if (!title || title.length < 4 || isMyGreenhouseBrandName(title)) return;

    const panelRoot = el.parentElement ?? el;
    const lines = elementText(panelRoot)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const titleIdx = lines.findIndex((line) => line === title);
    let company = "";
    if (titleIdx >= 0) {
      for (let i = titleIdx + 1; i < Math.min(titleIdx + 5, lines.length); i++) {
        const line = lines[i];
        if (/^(Remote|Hybrid|On[- ]site|Posted)/i.test(line)) break;
        if (line && !isMyGreenhouseBrandName(line) && !/^(jobs?|search)$/i.test(line)) {
          company = line;
          break;
        }
      }
    }

    if (!company) return;

    const score = rect.left + rect.width;
    if (!bestHolder.value || score > bestHolder.value.score) {
      bestHolder.value = { title, company, score };
    }
  });

  const best = bestHolder.value;
  if (best && isPlausibleJobHeader(best.title, best.company)) {
    return { title: best.title, company: best.company };
  }

  const panel = findMyGreenhouseDetailPanel(doc, null);
  if (!panel) return null;

  const panelText = elementText(panel);
  if (POSTED_PATTERN.test(panelText)) {
    const parsed = parseListCardHeader(panelText);
    if (parsed.title && parsed.company) {
      return parsed;
    }
  }

  const extracted = extractTitleCompanyFromPanel(panel);
  if (extracted.title && extracted.company) {
    return extracted;
  }

  return null;
}

/**
 * Best-effort title/company for the job the user is viewing.
 * Prefers list selection + recent click context over stale detail-pane text.
 */
function selectionMatches(
  a: { title: string; company: string },
  b: { title: string; company: string },
): boolean {
  return (
    textIncludesJobToken(a.title, b.title) &&
    textIncludesJobToken(a.company, b.company)
  );
}

export function parseJobHeaderFromText(
  text: string,
): { title: string; company: string } | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 2_500) return null;
  const headerSource = trimmed.length > 900 ? trimmed.slice(0, 900) : trimmed;
  if (!POSTED_PATTERN.test(headerSource) && trimmed.length > 500) return null;
  const parsed = parseListCardHeader(headerSource);
  if (isPlausibleJobHeader(parsed.title, parsed.company)) {
    return parsed;
  }
  return null;
}

/** Nearest job row from a click, including virtualized rows without card heuristics. */
export function findListCardFromClickEvent(
  event: Event,
  doc: Document,
): { element: Element; title: string; company: string } | null {
  const path =
    typeof event.composedPath === "function"
      ? event.composedPath()
      : [event.target];

  for (const node of path) {
    if (!(node instanceof Element)) continue;
    const fromCard = findListCardFromElement(node, doc);
    if (fromCard) return fromCard;
    const parsed = parseJobHeaderFromText(elementText(node));
    if (parsed) {
      return { element: node, title: parsed.title, company: parsed.company };
    }
  }
  return null;
}

export function resolveMyGreenhouseSelection(
  doc: Document,
): { title: string; company: string } | null {
  const clickCtx = readListClickMyGreenhouseJobContext();
  const listSelected = findSelectedJobListItem(doc);

  if (
    clickCtx &&
    listSelected &&
    isPlausibleJobHeader(clickCtx.title, clickCtx.company) &&
    isPlausibleJobHeader(listSelected.title, listSelected.company) &&
    !selectionMatches(clickCtx, listSelected)
  ) {
    const clickAge = Date.now() - clickCtx.ts;
    if (clickAge > FRESH_LIST_CLICK_MS) {
      clearListClickMyGreenhouseJobContext();
      return { title: listSelected.title, company: listSelected.company };
    }
    return { title: clickCtx.title, company: clickCtx.company };
  }

  if (clickCtx && isPlausibleJobHeader(clickCtx.title, clickCtx.company)) {
    return { title: clickCtx.title, company: clickCtx.company };
  }

  if (listSelected && isPlausibleJobHeader(listSelected.title, listSelected.company)) {
    return { title: listSelected.title, company: listSelected.company };
  }

  const header = findVisibleJobHeaderFromDetailPane(doc);
  if (header && isPlausibleJobHeader(header.title, header.company)) {
    return header;
  }

  const listCards = findAllListCards(doc);
  const detailPanel = findMyGreenhouseDetailPanel(doc, header ?? listSelected);
  if (detailPanel) {
    const panelText = elementText(detailPanel).slice(0, 1_500);
    const matched = findListCardMatchingDetailPane(listCards, panelText);
    if (matched && isPlausibleJobHeader(matched.title, matched.company)) {
      return { title: matched.title, company: matched.company };
    }
  }

  const refCtx = readRefMyGreenhouseJobContext();
  if (refCtx && isPlausibleJobHeader(refCtx.title, refCtx.company)) {
    const anchor = clickCtx ?? listSelected ?? header;
    if (!anchor || selectionMatches(refCtx, anchor)) {
      return { title: refCtx.title, company: refCtx.company };
    }
  }

  return null;
}

const MIN_JD_LENGTH = 200;

/** Posted · 36 minutes ago, Posted today, Posted 1 hour ago, etc. */
const POSTED_PATTERN =
  /Posted\s*(?:[·•]\s*)?(?:\d+\s*(?:minute|hour|day|week|month)s?\s+ago|today|yesterday|\d+\s+\w+\s+ago)/i;

const JOB_BODY_SIGNALS = [
  /Who you are/i,
  /What you get to do/i,
  /What you bring to the role/i,
  /Responsibilities/i,
  /Qualifications/i,
  /Requirements/i,
  /you will/i,
  /we are looking/i,
  /About the role/i,
  /Do work that matters/i,
];

const BODY_END_MARKERS = [
  /Profile checklist/i,
  /Drop your resume or browse to autofill/i,
  /Your job alerts/i,
  /This site uses cookies/i,
  /Recommended Roles/i,
  /Active applications/i,
  /Find the right role and make it your Dream Job/i,
  /Search smarter, apply faster/i,
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
  if (rect.width < 40 || rect.height < 24) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
}

function jobSignalCount(text: string): number {
  return JOB_BODY_SIGNALS.filter((pattern) => pattern.test(text)).length;
}

function normalizeMatchToken(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function textIncludesJobToken(text: string, token: string): boolean {
  const needle = normalizeMatchToken(token);
  if (!needle || needle.length < 3) return false;
  return normalizeMatchToken(text).includes(needle);
}

function hasSelectedMarker(el: Element): boolean {
  if (el.getAttribute("aria-selected") === "true") return true;
  if (el.getAttribute("aria-current") === "true") return true;
  if (el.getAttribute("data-selected") === "true") return true;
  const state = el.getAttribute("data-state");
  if (state === "active" || state === "checked" || state === "on") return true;
  const cls = typeof el.className === "string" ? el.className : "";
  if (/selected|active|highlighted|current|focused/i.test(cls)) return true;
  try {
    if (el.matches(":focus-within")) return true;
  } catch {
    // jsdom may not support :focus-within in matches()
  }
  return false;
}

/** List-row preview: title, company, location, Posted — almost no body after Posted. */
export function looksLikeListCardPreview(text: string): boolean {
  if (text.length >= 900) return false;
  if (!POSTED_PATTERN.test(text)) return false;
  const afterPosted = text.split(POSTED_PATTERN).slice(1).join(" ").trim();
  if (afterPosted.length >= 160) return false;
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length <= 12;
}

export function parseListCardHeader(text: string): { title: string; company: string } {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const postedIdx = lines.findIndex((line) => POSTED_PATTERN.test(line));
  const headerLines = postedIdx > 0 ? lines.slice(0, postedIdx) : lines.slice(0, 4);
  const title = headerLines[0] ?? "";
  const company = headerLines[1] ?? "";
  return {
    title: isMyGreenhouseBrandName(title) ? "" : title,
    company: isMyGreenhouseBrandName(company) ? "" : company,
  };
}

function collectListCards(
  doc: Document,
  requireVisible: boolean,
): Array<{ element: Element; title: string; company: string }> {
  const results: Array<{ element: Element; title: string; company: string }> = [];
  const seen = new Set<string>();

  const candidates: Element[] = [];
  forEachElementIncludingShadow(doc, (el) => {
    if (
      el.matches(
        "button, a, li, div, article, [role='button'], [role='option'], [role='listitem']",
      )
    ) {
      candidates.push(el);
    }
  });

  const viewportWidth = window.innerWidth || doc.documentElement.clientWidth || 1200;

  for (const el of candidates) {
    if (requireVisible && !isVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.left >= viewportWidth * 0.45) continue;
    const text = elementText(el);
    if (!looksLikeListCardPreview(text)) continue;
    const { title, company } = parseListCardHeader(text);
    if (!title || !company) continue;

    let hasQualifyingChild = false;
    for (const child of el.children) {
      const childText = elementText(child);
      if (!looksLikeListCardPreview(childText)) continue;
      const childHeader = parseListCardHeader(childText);
      if (childHeader.title && childHeader.company) {
        hasQualifyingChild = true;
        break;
      }
    }
    if (hasQualifyingChild) continue;

    const key = `${title}|${company}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ element: el, title, company });
  }

  return results;
}

export function findAllListCards(
  doc: Document,
): Array<{ element: Element; title: string; company: string }> {
  const visibleCards = collectListCards(doc, true);
  if (visibleCards.length > 0) return visibleCards;
  return collectListCards(doc, false);
}

/** Nearest job list card containing a click/focus target. */
export function findListCardFromElement(
  target: Element | null,
  doc: Document,
): { element: Element; title: string; company: string } | null {
  if (!target) return null;
  const cards = findAllListCards(doc);
  let node: Element | null = target;
  while (node && node !== doc.body) {
    for (const card of cards) {
      if (card.element === node || card.element.contains(node)) {
        return card;
      }
    }
    node = node.parentElement;
  }
  return null;
}

function findListCardMatchingDetailPane(
  cards: Array<{ element: Element; title: string; company: string }>,
  panelText: string,
): { element: Element; title: string; company: string } | null {
  for (const card of cards) {
    if (
      textIncludesJobToken(panelText, card.title) &&
      textIncludesJobToken(panelText, card.company)
    ) {
      return card;
    }
  }
  return null;
}

/** The highlighted row in the left job list reflects the open detail pane. */
export function findSelectedJobListItem(
  doc: Document,
): { title: string; company: string; element: Element } | null {
  const cards = findAllListCards(doc);

  for (const card of cards) {
    if (hasSelectedMarker(card.element)) {
      return card;
    }
    if (card.element.querySelector("[aria-selected='true'], [aria-current='true'], [data-selected='true']")) {
      return card;
    }
  }

  const active = doc.activeElement;
  if (active && active !== doc.body) {
    for (const card of cards) {
      if (card.element === active || card.element.contains(active) || active.contains(card.element)) {
        return card;
      }
    }
  }

  return null;
}

function scoreDetailPanel(
  el: Element,
  text: string,
  selected: { title: string; company: string } | null,
): number {
  if (looksLikeListCardPreview(text)) return -10_000;

  let score = text.length;
  score += jobSignalCount(text) * 400;

  if (selected) {
    if (textIncludesJobToken(text, selected.title)) score += 5_000;
    if (textIncludesJobToken(text, selected.company)) score += 2_500;
  }

  const rect = el.getBoundingClientRect();
  const viewportWidth = window.innerWidth || 1200;
  if (rect.left >= viewportWidth * 0.3) score += 800;
  if (text.length >= 500) score += 1_000;

  return score;
}

function findLargestRightPane(doc: Document): Element | null {
  const viewportWidth = window.innerWidth || doc.documentElement.clientWidth || 1200;
  let best: { el: Element; len: number } | null = null;

  for (const el of doc.querySelectorAll("main, main div, [role='main'], #app, #app div, body > div")) {
    if (!isVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.left < viewportWidth * 0.25) continue;
    const text = elementText(el);
    if (text.length < 300) continue;
    if (!best || text.length > best.len) {
      best = { el, len: text.length };
    }
  }

  return best?.el ?? null;
}

export function findMyGreenhouseDetailPanel(
  doc: Document,
  selected: { title: string; company: string } | null = findSelectedJobListItem(doc),
): Element | null {
  const viewportWidth = window.innerWidth || doc.documentElement.clientWidth || 1200;
  let best: { el: Element; score: number } | null = null;

  for (const el of doc.querySelectorAll(
    "main, main div, main article, main section, [role='main'] div, #app div, [class*='job'] div, [class*='Job'] div",
  )) {
    if (!isVisible(el)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.left < viewportWidth * 0.2) continue;

    const text = elementText(el);
    if (text.length < MIN_JD_LENGTH || text.length > 40_000) continue;
    if (/HomeProfileApplications|Dream Job/i.test(text.slice(0, 220))) continue;
    if (selected) {
      if (
        !textIncludesJobToken(text, selected.title) &&
        !textIncludesJobToken(text, selected.company)
      ) {
        continue;
      }
    } else if (jobSignalCount(text) < 1 && !POSTED_PATTERN.test(text)) {
      continue;
    }

    const score = scoreDetailPanel(el, text, selected);
    if (!best || score > best.score) {
      best = { el, score };
    }
  }

  if (best && best.score > 0) return best.el;
  return findLargestRightPane(doc);
}

export function extractTitleCompanyFromPanel(root: Element): { title: string; company: string } {
  const rejectName = (value: string) =>
    isMyGreenhouseBrandName(value) || /^(jobs?|search|home|profile)$/i.test(value.trim());

  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4"))
    .map((node) => elementText(node))
    .filter(
      (text) =>
        text.length > 2 &&
        !rejectName(text) &&
        !looksLikeLocationMetadata(text),
    );

  let title = headings[0] ?? "";
  let company = headings[1] ?? "";

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

function trimBodyChunk(chunk: string): string {
  let text = chunk;
  for (const marker of BODY_END_MARKERS) {
    const idx = text.search(marker);
    if (idx > 400) {
      text = text.slice(0, idx).trim();
      break;
    }
  }
  return text;
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

  let text = trimBodyChunk(raw);

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
  } else if (jobSignalCount(text) >= 1) {
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

/** Fallback when flex panels are hard to isolate: slice page text at the selected job header. */
export function extractFromBodyTextSlice(
  doc: Document,
  selected: { title: string; company: string },
): { title: string; company: string; text: string } | null {
  const full = elementText(doc.body);
  let start = full.indexOf(selected.title);
  if (start < 0) start = full.indexOf(selected.company);
  if (start < 0) return null;

  const chunk = trimBodyChunk(full.slice(start));
  const parsed = parseMyGreenhouseJobText(chunk);
  if (!parsed || parsed.text.length < MIN_JD_LENGTH) return null;

  return {
    title: selected.title,
    company: selected.company,
    text: parsed.text,
  };
}

export function extractMyGreenhouseFromDocument(
  doc: Document,
): { title: string; company: string; text: string } | null {
  const selected = findSelectedJobListItem(doc);

  if (selected) {
    const sliced = extractFromBodyTextSlice(doc, selected);
    if (sliced) return sliced;
  }

  const panel = findMyGreenhouseDetailPanel(doc, selected);
  if (panel) {
    const panelMeta = extractTitleCompanyFromPanel(panel);
    const { title, company } = pickExtractTitleCompany(selected, panelMeta);
    if (!isPlausibleJobHeader(title, company)) {
      return selected
        ? { title: selected.title, company: selected.company, text: "" }
        : null;
    }
    if (
      selected &&
      !detailPaneMatchesSelection(doc, selected)
    ) {
      return { title: selected.title, company: selected.company, text: "" };
    }

    const parsed = parseMyGreenhouseJobText(elementText(panel));
    if (parsed && parsed.text.length >= MIN_JD_LENGTH) {
      if (!isPlausibleJobHeader(parsed.title, parsed.company)) {
        return { title, company, text: parsed.text };
      }
      return {
        title: isPlausibleJobHeader(parsed.title, parsed.company) ? parsed.title : title,
        company: isPlausibleJobHeader(parsed.title, parsed.company) ? parsed.company : company,
        text: parsed.text,
      };
    }

    const fallbackBody = finalizeJdText(elementText(panel));
    if (fallbackBody.length >= MIN_JD_LENGTH && !isMyGreenhouseAggregatorNoise(fallbackBody)) {
      if (
        selected &&
        !textIncludesJobToken(fallbackBody, selected.title)
      ) {
        return { title: selected.title, company: selected.company, text: "" };
      }
      return { title, company, text: fallbackBody };
    }
  }

  if (selected) {
    return {
      title: selected.title,
      company: selected.company,
      text: "",
    };
  }

  return null;
}

export function isMyGreenhousePartialExtract(result: {
  title: string;
  company: string;
  text: string;
}): boolean {
  return Boolean(result.title.trim() && result.company.trim() && result.text.trim().length < MIN_JD_LENGTH);
}

export function sanitizeMyGreenhouseExtractedFields(
  title: string,
  company: string,
): { title: string; company: string } {
  const clean = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (isMyGreenhouseBrandName(trimmed) || looksLikeLocationMetadata(trimmed)) return "";
    return trimmed;
  };
  return {
    title: clean(title),
    company: clean(company),
  };
}
