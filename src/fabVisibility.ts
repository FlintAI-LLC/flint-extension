/**
 * User-controlled visibility for the in-page floating action button (FAB).
 * The toolbar / drawer can still open the panel when the FAB is hidden.
 */

export const FAB_HIDE_GLOBAL_KEY = "flint_fab_hide_global";
export const FAB_SNOOZE_UNTIL_KEY = "flint_fab_snooze_until";
export const FAB_HIDE_HOSTS_SESSION_KEY = "flint_fab_hide_hosts_session";

const SNOOZE_MS = 24 * 60 * 60 * 1000;

export type FabHideReason = "none" | "site_session" | "snooze" | "global";

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

export function hostnameFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

async function readSessionHiddenHosts(): Promise<string[]> {
  const result = await chrome.storage.session.get(FAB_HIDE_HOSTS_SESSION_KEY);
  const raw = result[FAB_HIDE_HOSTS_SESSION_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is string => typeof h === "string").map(normalizeHostname);
}

async function writeSessionHiddenHosts(hosts: string[]): Promise<void> {
  await chrome.storage.session.set({ [FAB_HIDE_HOSTS_SESSION_KEY]: hosts });
}

export async function getFabHideReason(hostname: string): Promise<FabHideReason> {
  const host = normalizeHostname(hostname);
  const local = await chrome.storage.local.get([FAB_HIDE_GLOBAL_KEY, FAB_SNOOZE_UNTIL_KEY]);
  if (local[FAB_HIDE_GLOBAL_KEY] === true) return "global";

  const until = local[FAB_SNOOZE_UNTIL_KEY];
  if (typeof until === "number" && until > Date.now()) return "snooze";
  if (typeof until === "number" && until <= Date.now()) {
    await chrome.storage.local.remove(FAB_SNOOZE_UNTIL_KEY);
  }

  const sessionHosts = await readSessionHiddenHosts();
  if (sessionHosts.includes(host)) return "site_session";
  return "none";
}

export async function shouldShowFab(hostname: string): Promise<boolean> {
  return (await getFabHideReason(hostname)) === "none";
}

export async function hideFabOnSiteForSession(hostname: string): Promise<void> {
  const host = normalizeHostname(hostname);
  const hosts = await readSessionHiddenHosts();
  if (!hosts.includes(host)) {
    hosts.push(host);
    await writeSessionHiddenHosts(hosts);
  }
}

export async function hideFabFor24Hours(): Promise<void> {
  await chrome.storage.local.set({ [FAB_SNOOZE_UNTIL_KEY]: Date.now() + SNOOZE_MS });
}

export async function hideFabOnAllSites(): Promise<void> {
  await chrome.storage.local.set({ [FAB_HIDE_GLOBAL_KEY]: true });
}

/** Clears snooze, global hide, and site-session hide for the given host (if any). */
export async function restoreFabVisibility(hostname?: string): Promise<void> {
  await chrome.storage.local.remove([FAB_HIDE_GLOBAL_KEY, FAB_SNOOZE_UNTIL_KEY]);
  if (!hostname) {
    await chrome.storage.session.remove(FAB_HIDE_HOSTS_SESSION_KEY);
    return;
  }
  const host = normalizeHostname(hostname);
  const hosts = (await readSessionHiddenHosts()).filter((h) => h !== host);
  if (hosts.length === 0) {
    await chrome.storage.session.remove(FAB_HIDE_HOSTS_SESSION_KEY);
  } else {
    await writeSessionHiddenHosts(hosts);
  }
}

export function currentPageHostname(): string {
  return normalizeHostname(window.location.hostname);
}
