const LEGACY_CONTEXT_KEY = "flint_mygh_last_job_context_v1";
const LIST_CLICK_KEY = "flint_mygh_list_click_v1";
const REF_CONTEXT_KEY = "flint_mygh_ref_context_v1";
const LIST_CLICK_TTL_MS = 90_000;
const NETWORK_JOB_CACHE_KEY = "flint_my_greenhouse_boards_job_v2";

function clearMyGreenhouseNetworkJobCache(): void {
  try {
    sessionStorage.removeItem(NETWORK_JOB_CACHE_KEY);
    sessionStorage.removeItem("flint_my_greenhouse_boards_job_v1");
  } catch {
    // sessionStorage unavailable.
  }
}

export interface MyGreenhouseJobContext {
  title: string;
  company: string;
  boardToken?: string;
  jobId?: string;
  ts: number;
}

/** Drop poisoned v0.1.9 session cache that stored stale title/company without a click or ref. */
export function clearLegacyMyGreenhouseJobContext(): void {
  try {
    sessionStorage.removeItem(LEGACY_CONTEXT_KEY);
  } catch {
    // sessionStorage unavailable.
  }
}

export function clearRefMyGreenhouseJobContext(): void {
  try {
    sessionStorage.removeItem(REF_CONTEXT_KEY);
  } catch {
    // sessionStorage unavailable.
  }
}

export function clearListClickMyGreenhouseJobContext(): void {
  try {
    sessionStorage.removeItem(LIST_CLICK_KEY);
  } catch {
    // sessionStorage unavailable.
  }
}

export function writeListClickMyGreenhouseJobContext(
  ctx: Omit<MyGreenhouseJobContext, "ts">,
): void {
  try {
    sessionStorage.setItem(
      LIST_CLICK_KEY,
      JSON.stringify({ ...ctx, ts: Date.now() }),
    );
    clearRefMyGreenhouseJobContext();
    clearMyGreenhouseNetworkJobCache();
  } catch {
    // sessionStorage unavailable.
  }
}

export function readListClickMyGreenhouseJobContext(
  maxAgeMs = LIST_CLICK_TTL_MS,
): MyGreenhouseJobContext | null {
  return readContext(LIST_CLICK_KEY, maxAgeMs);
}

export function writeRefMyGreenhouseJobContext(
  ctx: Omit<MyGreenhouseJobContext, "ts"> & { boardToken: string; jobId: string },
): void {
  try {
    sessionStorage.setItem(
      REF_CONTEXT_KEY,
      JSON.stringify({ ...ctx, ts: Date.now() }),
    );
  } catch {
    // sessionStorage unavailable.
  }
}

export function readRefMyGreenhouseJobContext(
  maxAgeMs = 120_000,
): MyGreenhouseJobContext | null {
  const ctx = readContext(REF_CONTEXT_KEY, maxAgeMs);
  if (!ctx?.boardToken || !ctx.jobId) return null;
  return ctx;
}

function readContext(key: string, maxAgeMs: number): MyGreenhouseJobContext | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MyGreenhouseJobContext;
    if (!parsed.title || !parsed.company || !parsed.ts) return null;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}
