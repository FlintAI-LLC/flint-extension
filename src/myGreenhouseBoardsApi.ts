import {
  boardsApiJobUrl,
  boardsApiJobsListUrl,
  collectGreenhouseBoardJobRefs,
  jobFromBoardsApiPayload,
  type GreenhouseBoardJobRef,
  parseGreenhouseBoardJobUrl,
} from "./greenhouseBoardsApi.js";
import { forEachElementIncludingShadow } from "./shadowDomWalk.js";
import {
  detailPaneMatchesSelection,
  isPlausibleJobHeader,
  findSelectedJobListItem,
  resolveMyGreenhouseSelection,
} from "./myGreenhouseExtract.js";
import { readRefMyGreenhouseJobContext } from "./myGreenhouseContext.js";
import { extractJobFromInertiaPage } from "./myGreenhouseInertia.js";
import { waitForMyGreenhouseJobContext } from "./myGreenhouseWait.js";
const MY_GREENHOUSE_NETWORK_CACHE_KEY = "flint_my_greenhouse_boards_job_v2";

export interface FetchGreenhouseBoardJobResult {
  title: string;
  company: string;
  text: string;
  absoluteUrl: string;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokensMatch(haystack: string, needle: string): boolean {
  const n = normalizeToken(needle);
  if (!n || n.length < 3) return false;
  return normalizeToken(haystack).includes(n);
}

export function jobMatchesSelection(
  job: Pick<FetchGreenhouseBoardJobResult, "title" | "company">,
  selected: { title: string; company: string },
): boolean {
  if (!isPlausibleJobHeader(selected.title, selected.company)) return false;
  if (!selected.title || !tokensMatch(job.title, selected.title)) return false;
  if (selected.company) {
    if (!job.company || !tokensMatch(job.company, selected.company)) return false;
  }
  return true;
}

function refsPreferringDetailPane(
  refs: GreenhouseBoardJobRef[],
  doc: Document,
): GreenhouseBoardJobRef[] {
  const viewportWidth = window.innerWidth || doc.documentElement.clientWidth || 1200;
  const detailRefs: GreenhouseBoardJobRef[] = [];

  for (const ref of refs) {
    let inDetail = false;
    forEachElementIncludingShadow(doc, (el) => {
      if (!(el instanceof HTMLAnchorElement || el instanceof HTMLIFrameElement)) return;
      const haystack = el instanceof HTMLAnchorElement ? el.href : el.src;
      if (!haystack.includes(ref.jobId) || !haystack.includes(ref.boardToken)) return;
      const rect = el.getBoundingClientRect();
      if (rect.left >= viewportWidth * 0.22) inDetail = true;
    });
    if (inDetail) detailRefs.push(ref);
  }

  return detailRefs.length > 0 ? detailRefs : refs;
}

function rankJobRefs(
  refs: GreenhouseBoardJobRef[],
  doc: Document,
  selected: { title: string; company: string } | null,
): GreenhouseBoardJobRef[] {
  if (refs.length === 0) return [];
  const best = pickBestGreenhouseJobRef(refs, doc, selected);
  const ranked: GreenhouseBoardJobRef[] = [];
  if (best) ranked.push(best);
  for (const ref of refs) {
    if (ranked.some((entry) => entry.boardToken === ref.boardToken && entry.jobId === ref.jobId)) {
      continue;
    }
    ranked.push(ref);
  }
  return ranked;
}

function elementContainsRef(el: Element, ref: GreenhouseBoardJobRef): boolean {
  const html = el.innerHTML;
  return (
    html.includes(ref.jobId) &&
    (html.includes(ref.boardToken) ||
      html.includes(`boards.greenhouse.io/${ref.boardToken}`) ||
      html.includes(`job-boards.greenhouse.io/${ref.boardToken}`))
  );
}

function scoreJobRef(
  ref: GreenhouseBoardJobRef,
  doc: Document,
  selected: { title: string; company: string } | null,
): number {
  let score = 0;

  for (const el of doc.querySelectorAll("a[href]")) {
    if (!(el instanceof HTMLAnchorElement)) continue;
    const parsed = parseGreenhouseBoardJobUrl(el.href);
    if (!parsed || parsed.jobId !== ref.jobId || parsed.boardToken !== ref.boardToken) continue;

    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth || doc.documentElement.clientWidth || 1200;
    if (rect.left >= viewportWidth * 0.25) score += 2_000;
    if (/apply/i.test(el.textContent ?? "")) score += 1_500;
    score += 500;
  }

  const panelCandidates = doc.querySelectorAll(
    "main, [role='main'], #app, [class*='detail'], [class*='Detail'], [class*='panel'], [class*='Panel']",
  );
  for (const el of panelCandidates) {
    if (!elementContainsRef(el, ref)) continue;
    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth || doc.documentElement.clientWidth || 1200;
    if (rect.left >= viewportWidth * 0.2) score += 800;
    score += 400;
  }

  if (selected) {
    const selectedEl = findSelectedJobListItem(doc)?.element;
    if (selectedEl && elementContainsRef(selectedEl, ref)) score += 300;
  }

  return score;
}

export function pickBestGreenhouseJobRef(
  refs: GreenhouseBoardJobRef[],
  doc: Document,
  selected: { title: string; company: string } | null,
): GreenhouseBoardJobRef | null {
  if (refs.length === 0) return null;
  if (refs.length === 1) return refs[0];

  let best: { ref: GreenhouseBoardJobRef; score: number } | null = null;
  for (const ref of refs) {
    const score = scoreJobRef(ref, doc, selected);
    if (!best || score > best.score) {
      best = { ref, score };
    }
  }

  return best?.ref ?? refs[0];
}

export function readNetworkCacheMatchingSelection(
  selected: { title: string; company: string },
): FetchGreenhouseBoardJobResult | null {
  try {
    const raw = sessionStorage.getItem(MY_GREENHOUSE_NETWORK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      ts?: number;
      job?: FetchGreenhouseBoardJobResult;
    };
    if (!parsed.job || !parsed.ts) return null;
    if (Date.now() - parsed.ts > 5 * 60_000) return null;
    if (!jobMatchesSelection(parsed.job, selected)) return null;
    if (!isPlausibleJobHeader(parsed.job.title, parsed.job.company || selected.company)) {
      return null;
    }
    if (parsed.job.text.length < 200) return null;
    return parsed.job;
  } catch {
    return null;
  }
}

export function readMyGreenhouseNetworkJobCache(
  ref?: Pick<GreenhouseBoardJobRef, "boardToken" | "jobId">,
): FetchGreenhouseBoardJobResult | null {
  if (!ref) return null;

  try {
    const raw = sessionStorage.getItem(MY_GREENHOUSE_NETWORK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      ts?: number;
      boardToken?: string;
      jobId?: string;
      job?: FetchGreenhouseBoardJobResult;
    };
    if (!parsed.job || !parsed.ts || !parsed.boardToken || !parsed.jobId) return null;
    if (parsed.boardToken !== ref.boardToken || parsed.jobId !== ref.jobId) return null;
    if (Date.now() - parsed.ts > 5 * 60_000) return null;
    if (parsed.job.text.length < 200) return null;
    return parsed.job;
  } catch {
    return null;
  }
}

export function writeMyGreenhouseNetworkJobCache(
  job: FetchGreenhouseBoardJobResult,
  ref: Pick<GreenhouseBoardJobRef, "boardToken" | "jobId">,
): void {
  try {
    sessionStorage.setItem(
      MY_GREENHOUSE_NETWORK_CACHE_KEY,
      JSON.stringify({
        ts: Date.now(),
        boardToken: ref.boardToken,
        jobId: ref.jobId,
        job,
      }),
    );
  } catch {
    // sessionStorage may be unavailable.
  }
}

export function clearMyGreenhouseNetworkJobCache(): void {
  try {
    sessionStorage.removeItem(MY_GREENHOUSE_NETWORK_CACHE_KEY);
    sessionStorage.removeItem("flint_my_greenhouse_boards_job_v1");
  } catch {
    // sessionStorage may be unavailable.
  }
}

async function fetchJsonViaServiceWorker(url: string): Promise<Record<string, unknown> | null> {
  try {
    const result = (await chrome.runtime.sendMessage({
      type: "FETCH_JSON",
      url,
    })) as { json?: Record<string, unknown>; error?: string };
    if (result.json) return result.json;
    return null;
  } catch {
    return null;
  }
}

export async function fetchGreenhouseBoardJob(
  boardToken: string,
  jobId: string,
): Promise<FetchGreenhouseBoardJobResult | null> {
  const data = await fetchJsonViaServiceWorker(boardsApiJobUrl(boardToken, jobId));
  if (!data) return null;

  const parsed = jobFromBoardsApiPayload(data);
  if (!parsed) return null;

  const absoluteUrl =
    typeof data.absolute_url === "string"
      ? data.absolute_url
      : `https://job-boards.greenhouse.io/${boardToken}/jobs/${jobId}`;

  const job: FetchGreenhouseBoardJobResult = {
    title: parsed.title,
    company: parsed.company,
    text: parsed.text,
    absoluteUrl,
  };
  writeMyGreenhouseNetworkJobCache(job, { boardToken, jobId });
  return job;
}

async function matchJobFromBoardList(
  boardToken: string,
  selected: { title: string; company: string },
): Promise<FetchGreenhouseBoardJobResult | null> {
  const data = await fetchJsonViaServiceWorker(boardsApiJobsListUrl(boardToken));
  if (!data || !Array.isArray(data.jobs)) return null;

  let best: FetchGreenhouseBoardJobResult | null = null;
  let bestScore = -1;

  for (const entry of data.jobs) {
    if (typeof entry !== "object" || entry === null) continue;
    const jobRecord = entry as Record<string, unknown>;
    const parsed = jobFromBoardsApiPayload(jobRecord);
    if (!parsed) continue;

    let score = 0;
    if (normalizeToken(parsed.title) === normalizeToken(selected.title)) score += 5;
    else if (tokensMatch(parsed.title, selected.title)) score += 3;
    if (selected.company) {
      if (normalizeToken(parsed.company) === normalizeToken(selected.company)) score += 4;
      else if (tokensMatch(parsed.company, selected.company)) score += 2;
    }

    if (score <= bestScore) continue;

    const jobId = String(jobRecord.id ?? "");
    const absoluteUrl =
      typeof jobRecord.absolute_url === "string"
        ? jobRecord.absolute_url
        : jobId
          ? `https://job-boards.greenhouse.io/${boardToken}/jobs/${jobId}`
          : "";

    bestScore = score;
    best = {
      title: parsed.title,
      company: parsed.company,
      text: parsed.text,
      absoluteUrl,
    };
  }

  return bestScore >= 5 ? best : null;
}

/**
 * Resolve the open MyGreenhouse posting via the public Greenhouse Job Board API.
 * MyGreenhouse embeds apply links to job-boards.greenhouse.io; we follow those ids.
 */
async function jobFromInertia(doc: Document): Promise<FetchGreenhouseBoardJobResult | null> {
  const inertiaJob = extractJobFromInertiaPage(doc);
  if (!inertiaJob) return null;

  if (inertiaJob.text.length >= 200) {
    return {
      title: inertiaJob.title,
      company: inertiaJob.company,
      text: inertiaJob.text,
      absoluteUrl: window.location.href,
    };
  }

  if (inertiaJob.boardToken && inertiaJob.jobId) {
    return fetchGreenhouseBoardJob(inertiaJob.boardToken, inertiaJob.jobId);
  }

  return null;
}

async function loadJobForRef(
  ref: GreenhouseBoardJobRef,
): Promise<FetchGreenhouseBoardJobResult | null> {
  const cached = readMyGreenhouseNetworkJobCache(ref);
  if (cached) return cached;
  return fetchGreenhouseBoardJob(ref.boardToken, ref.jobId);
}

function guessBoardTokens(company: string, refs: GreenhouseBoardJobRef[]): string[] {
  const tokens = new Set<string>(refs.map((ref) => ref.boardToken));
  const recent = readRefMyGreenhouseJobContext();
  if (recent?.boardToken) tokens.add(recent.boardToken);

  const compact = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact) tokens.add(compact);

  const words = company
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
  if (words[0]) tokens.add(words[0]);
  if (words.length >= 2) tokens.add(`${words[0]}${words[1]}`);
  if (words.length >= 2) tokens.add(`${words[0]}-${words[1]}`);

  return [...tokens].filter(Boolean);
}

async function resolveViaBoardList(
  selected: { title: string; company: string },
  refs: GreenhouseBoardJobRef[],
): Promise<FetchGreenhouseBoardJobResult | null> {
  const boardTokens = guessBoardTokens(selected.company, refs);

  for (const boardToken of boardTokens) {
    const matched = await matchJobFromBoardList(boardToken, selected);
    if (matched) {
      const jobIdMatch = refs.find(
        (ref) =>
          ref.boardToken === boardToken &&
          tokensMatch(matched.title, selected.title) &&
          tokensMatch(matched.company, selected.company),
      );
      if (jobIdMatch) {
        writeMyGreenhouseNetworkJobCache(matched, jobIdMatch);
      }
      return matched;
    }
  }

  return null;
}

export async function extractMyGreenhouseViaBoardsApi(
  doc: Document,
): Promise<FetchGreenhouseBoardJobResult | null> {
  await waitForMyGreenhouseJobContext(doc);

  const selected = resolveMyGreenhouseSelection(doc);
  if (
    selected &&
    isPlausibleJobHeader(selected.title, selected.company)
  ) {
    await waitForDetailPaneMatchingSelection(doc, selected);
  }
  const allRefs = collectGreenhouseBoardJobRefs(doc);
  const refs = refsPreferringDetailPane(allRefs, doc);
  const rankedRefs = rankJobRefs(refs, doc, selected);

  if (selected?.title && selected.company) {
    const networkCached = readNetworkCacheMatchingSelection(selected);
    if (networkCached) {
      return networkCached;
    }

    if (rankedRefs.length === 0) {
      const fromList = await resolveViaBoardList(selected, refs);
      if (fromList && jobMatchesSelection(fromList, selected)) return fromList;
    }

    for (const ref of rankedRefs) {
      const job = await loadJobForRef(ref);
      if (!job) continue;
      if (jobMatchesSelection(job, selected)) {
        return job;
      }
    }
  }

  const inertiaResolved = await jobFromInertia(doc);
  if (
    inertiaResolved &&
    selected &&
    isPlausibleJobHeader(selected.title, selected.company) &&
    jobMatchesSelection(inertiaResolved, selected)
  ) {
    return inertiaResolved;
  }

  if (!selected?.title || !selected.company) return null;
  if (!isPlausibleJobHeader(selected.title, selected.company)) return null;

  const fromList = await resolveViaBoardList(selected, refs);
  if (fromList && jobMatchesSelection(fromList, selected)) return fromList;
  return null;
}

async function waitForDetailPaneMatchingSelection(
  doc: Document,
  selected: { title: string; company: string },
  maxWaitMs = 4_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (detailPaneMatchesSelection(doc, selected)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
