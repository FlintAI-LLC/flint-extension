import React, { useEffect, useRef, useState } from "react";
import type {
  ExtractedJD,
  GoogleLoginResult,
  InjectJdExtractorResult,
  ParseJdFromUrlResult,
} from "../src/types.js";
import { formatApiErrorMessage } from "../src/formatApiError.js";
import { getAccessTokenOrNull, login, logout } from "../src/auth.js";
import { ApiError, apiSaveJD } from "../src/api.js";
import { buildTailorInFlintApplyUrl, getGoogleClientId } from "../src/urls.js";
import { PRODUCT_NAME, FLINT_DESKTOP_NAME, FLINT_DESKTOP_HANDOFF_ENABLED } from "../src/brand.js";
import { PopupHeader } from "./BrandWordmark.js";
import { isLinkedInJobPage, resolveLinkedInJobFetchUrl } from "../src/linkedinJobUrl.js";
import {
  isMyGreenhouseHost,
  isMyGreenhousePartialExtract,
  sanitizeMyGreenhouseExtractedFields,
} from "../src/myGreenhouseExtract.js";
import { extensionInvalidatedMessage, isExtensionContextValid } from "../src/extensionContext.js";
import { getExtensionVersion } from "../src/extensionVersion.js";
import { resolveHostTab } from "../src/resolveHostTab.js";
import { FLINT_JD_REFRESH_EVENT } from "../src/panelMessages.js";
import { isUncertainJdSource } from "../src/jdCompleteness.js";
import {
  pickBetterJd,
  scoreJdText,
  finalizeJdText,
  finalizeJdTextFromMaybeHtml,
  extractJobPostingFromHtml,
  JD_MAX_CHARS,
  JD_MIN_LENGTH,
  truncateJdText,
} from "../src/jdParse.js";
import { buildFlintImportDeepLink, dispatchFlintDeepLinkFromPopup, FLINT_DOWNLOAD_URL, openFlintDeepLinkFromPopup } from "../src/flintDeepLink.js";
import { isAutofillEnabled, isAutofillHost, isLinkedInHost } from "../src/autofillFlags.js";

const GOOGLE_ENABLED = Boolean(getGoogleClientId());

// MV3 service workers sleep between events. When the popup sends the first
// message, there is a race window where Chrome has woken the SW but it has
// not yet registered its onMessage listener. Retry with back-off until the
// channel is open or we give up.
async function _sendGoogleLoginToSW(
  maxAttempts = 6,
  baseDelayMs = 200,
): Promise<GoogleLoginResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await new Promise<GoogleLoginResult>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "GOOGLE_LOGIN" },
          (res: GoogleLoginResult | undefined) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (res) {
              resolve(res);
            } else {
              // Firefox: service worker returned false with no sendResponse.
              // Treat as pending; popup waits on chrome.storage.onChanged.
              resolve({ success: false, error: "", pending: true });
            }
          },
        );
      });
      return result;
    } catch (err) {
      const isConnectionError =
        err instanceof Error &&
        (err.message.includes("does not exist") || err.message.includes("establish connection"));

      if (isConnectionError && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Service worker unreachable — please try again.");
}

const FETCH_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const FETCH_TIMEOUT_MS = 4000;
const EXTRACTION_TIMEOUT_MS = 7000;
const MY_GREENHOUSE_POPUP_TIMEOUT_MS = 16_000;

function _withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** Fetch page HTML from the popup (extension context — no sleeping service worker). */
async function _parseJdFromUrlDirect(
  url: string,
): Promise<{ title: string; company: string; text: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, signal: controller.signal });
    if (!response.ok) return null;
    const html = await response.text();
    const parsed = extractJobPostingFromHtml(html);
    if (parsed && parsed.text.trim().length >= 200) return parsed;
  } catch {
    // Network, abort, or parse failure — caller tries other paths.
  } finally {
    clearTimeout(timer);
  }
  return null;
}

async function _parseJdFromUrlViaServiceWorker(
  url: string,
  maxAttempts = 2,
  baseDelayMs = 150,
): Promise<{ title: string; company: string; text: string } | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await new Promise<ParseJdFromUrlResult>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "PARSE_JD_FROM_URL", url },
          (res: ParseJdFromUrlResult | undefined) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (res) {
              resolve(res);
            } else {
              reject(new Error("No response from service worker"));
            }
          },
        );
      });
      if ("jd" in result && result.jd && result.jd.text.trim().length >= 200) {
        return result.jd;
      }
    } catch (err) {
      const isConnectionError =
        err instanceof Error &&
        (err.message.includes("does not exist") ||
          err.message.includes("establish connection") ||
          err.message.includes("No response"));
      if (isConnectionError && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
        continue;
      }
    }
  }
  return null;
}

async function _injectJdExtractor(tabId: number): Promise<void> {
  // Firefox resolves executeScript `files` relative to the popup URL when called
  // from the popup (…/popup/content/jd-extractor.js). Inject from the service
  // worker so paths stay relative to the extension root.
  await new Promise<void>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "INJECT_JD_EXTRACTOR", tabId },
      (_res: InjectJdExtractorResult | undefined) => {
        resolve();
      },
    );
  });
}

function isUsableExtractedJd(jd: ExtractedJD, tabUrl?: string): boolean {
  if (jd.text.length >= 200) return true;
  if (!tabUrl) return false;
  try {
    if (!isMyGreenhouseHost(new URL(tabUrl).hostname)) return false;
  } catch {
    return false;
  }
  return isMyGreenhousePartialExtract(jd);
}

async function _extractJdFromTab(tabId: number, tabUrl?: string): Promise<ExtractedJD | null> {
  await _injectJdExtractor(tabId);

  const myGreenhouseTab = (() => {
    if (!tabUrl) return false;
    try {
      return isMyGreenhouseHost(new URL(tabUrl).hostname);
    } catch {
      return false;
    }
  })();
  const maxAttempts = myGreenhouseTab ? 12 : 5;
  const retryDelayMs = myGreenhouseTab ? 500 : 120;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await new Promise<{ type: string; jd?: ExtractedJD; error?: string }>(
      (resolve) => {
        chrome.tabs.sendMessage(tabId, { type: "EXTRACT_JD" }, (msg) => {
          if (chrome.runtime.lastError || !msg) {
            const err = chrome.runtime.lastError?.message ?? "No response";
            resolve({ type: "JD_ERROR", error: err });
          } else {
            resolve(msg);
          }
        });
      },
    );

    if (response.type === "JD_RESULT" && response.jd) {
      if (isUsableExtractedJd(response.jd, tabUrl)) {
        return response.jd;
      }
      if (attempt === maxAttempts - 1 && tabUrl) {
        try {
          if (isMyGreenhouseHost(new URL(tabUrl).hostname) && isMyGreenhousePartialExtract(response.jd)) {
            return response.jd;
          }
        } catch {
          // ignore invalid tab URL
        }
      }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
  return null;
}

type View = "loading" | "login" | "not_on_job" | "manual_entry" | "job_ready" | "saving" | "saved" | "error";

const FLINT_NOT_INSTALLED_TIMEOUT_MS = 3000;
const RESTRICTED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "moz-extension://",
  "view-source:",
  "data:",
  "file://",
];

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// Removed — header uses Flint Apply wordmark via PopupHeader.
export function Popup(): React.ReactElement {
  const [view, setView] = useState<View>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [jd, setJd] = useState<ExtractedJD | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notOnJobMessage, setNotOnJobMessage] = useState<string | null>(null);
  const [flintFallback, setFlintFallback] = useState(false);
  const [savedJdId, setSavedJdId] = useState<string | null>(null);
  const [savedExportToken, setSavedExportToken] = useState<string | null>(null);
  const [copiedImportLink, setCopiedImportLink] = useState(false);
  const [tabUrl, setTabUrl] = useState<string | undefined>(undefined);
  const [manualTitle, setManualTitle] = useState("");
  const [manualCompany, setManualCompany] = useState("");
  const [manualText, setManualText] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>("Detecting job description…");
  const [autofillEnabled, setAutofillEnabled] = useState(true);
  const [autofillHint, setAutofillHint] = useState<string | null>(null);
  const extractJdRef = useRef<() => Promise<void>>(async () => {});
  const manualEntryReturnRef = useRef<View>("not_on_job");

  useEffect(() => {
    void _init();
    return () => {
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      if (initWatchdogRef.current) clearTimeout(initWatchdogRef.current);
    };
  }, []);

  useEffect(() => {
    const onRefresh = (_event: Event) => {
      void (async () => {
        const token = await getAccessTokenOrNull();
        if (!token) return;
        setJd(null);
        setSavedJdId(null);
        setView("loading");
        setLoadingStatus("Reading the job posting…");
        await extractJdRef.current();
      })();
    };
    window.addEventListener(FLINT_JD_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(FLINT_JD_REFRESH_EVENT, onRefresh);
  }, []);

  async function _init(): Promise<void> {
    if (!isExtensionContextValid()) {
      setErrorMessage(extensionInvalidatedMessage());
      setView("error");
      return;
    }

    // Watchdog: if anything in _init hangs (auth refresh, executeScript on a
    // sandboxed page, etc.), force a transition out of the spinner so the
    // user can either log in or paste manually.
    initWatchdogRef.current = setTimeout(() => {
      setView((prev) =>
        prev === "loading"
          ? "not_on_job"
          : prev,
      );
      setNotOnJobMessage(
        "Detection took too long. Paste the job description manually below.",
      );
    }, 20_000);

    try {
      setLoadingStatus("Checking your session…");
      const token = await getAccessTokenOrNull();
      if (!token) {
        setView("login");
        return;
      }
      chrome.runtime.sendMessage({ type: "FETCH_RECENT_TAILORED_SESSIONS" });
      setLoadingStatus("Reading the job posting…");
      await _extractJD();
    } catch (err) {
      setNotOnJobMessage(
        err instanceof Error
          ? `Could not read this page (${err.message}). Paste the job description manually below.`
          : "Could not read this page. Paste the job description manually below.",
      );
      setView("not_on_job");
    } finally {
      if (initWatchdogRef.current) {
        clearTimeout(initWatchdogRef.current);
        initWatchdogRef.current = null;
      }
    }
  }

  async function _extractJD(): Promise<void> {
    const tab = await resolveHostTab();
    setTabUrl(tab?.url);
    if (!tab?.id) {
      setNotOnJobMessage(null);
      setView("not_on_job");
      return;
    }

    if (isRestrictedUrl(tab.url) || !tab.url?.startsWith("http")) {
      setNotOnJobMessage(
        "Cannot access this page. Open a LinkedIn, Greenhouse, Jobright, or other job listing.",
      );
      setView("not_on_job");
      return;
    }

    const fetchUrl = tab.url ? resolveLinkedInJobFetchUrl(tab.url) : tab.url;
    // LinkedIn is a fully client-rendered SPA — unauthenticated HTML fetches
    // never contain JSON-LD and take 1-3s for nothing. Skip them and rely
    // entirely on the content script which has the live authenticated DOM.
    const skipHtmlFetch = tab.url
      ? isLinkedInJobPage(tab.url) || isMyGreenhouseHost(new URL(tab.url).hostname)
      : false;

    const extractTimeoutMs =
      tab.url && isMyGreenhouseHost(new URL(tab.url).hostname)
        ? MY_GREENHOUSE_POPUP_TIMEOUT_MS
        : EXTRACTION_TIMEOUT_MS;
    const extractFallback = [null, null, null] as [
      { title: string; company: string; text: string } | null,
      { title: string; company: string; text: string } | null,
      ExtractedJD | null,
    ];
    const extractResults = await new Promise<typeof extractFallback>((resolve) => {
      const timer = setTimeout(() => {
        resolve(extractFallback);
      }, extractTimeoutMs);
      Promise.all([
        !skipHtmlFetch && fetchUrl ? _parseJdFromUrlDirect(fetchUrl) : Promise.resolve(null),
        !skipHtmlFetch && fetchUrl ? _parseJdFromUrlViaServiceWorker(fetchUrl) : Promise.resolve(null),
        _extractJdFromTab(tab.id, tab.url),
      ]).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          resolve(extractFallback);
        },
      );
    });
    const [directParsed, swParsed, pageJd] = extractResults;

    const structuredParsed = directParsed ?? swParsed;

    const swAsExtracted: ExtractedJD | null = structuredParsed
      ? {
          title: structuredParsed.title || tab.title || "Untitled Role",
          company: structuredParsed.company,
          text: structuredParsed.text,
          url: tab.url,
          extraction_method: "structured",
        }
      : null;

    const myGreenhouseTab =
      tab.url && (() => {
        try {
          return isMyGreenhouseHost(new URL(tab.url).hostname);
        } catch {
          return false;
        }
      })();

    const bestParsed = myGreenhouseTab
      ? pageJd
        ? { title: pageJd.title, company: pageJd.company, text: pageJd.text }
        : null
      : pickBetterJd(
          swAsExtracted
            ? { title: swAsExtracted.title, company: swAsExtracted.company, text: swAsExtracted.text }
            : null,
          pageJd
            ? { title: pageJd.title, company: pageJd.company, text: pageJd.text }
            : null,
        );

    if (
      bestParsed &&
      bestParsed.text.trim().length >= 200 &&
      (myGreenhouseTab || structuredParsed || scoreJdText(finalizeJdText(bestParsed.text)) >= 0)
    ) {
      const structuredWinner =
        !myGreenhouseTab &&
        structuredParsed !== null &&
        bestParsed.text === structuredParsed.text &&
        bestParsed.title === structuredParsed.title;
      const finalText = structuredWinner
        ? truncateJdText(bestParsed.text)
        : finalizeJdText(bestParsed.text);
      const ghFields = myGreenhouseTab
        ? sanitizeMyGreenhouseExtractedFields(bestParsed.title, bestParsed.company)
        : { title: bestParsed.title, company: bestParsed.company };
      setJd({
        title: ghFields.title || bestParsed.title || tab.title || "Untitled Role",
        company: ghFields.company,
        text: finalText,
        url: tab.url,
        extraction_method: myGreenhouseTab
          ? (pageJd?.extraction_method ?? "structured")
          : structuredParsed
            ? "structured"
            : (pageJd?.extraction_method ?? "heuristic"),
      });
      setNotOnJobMessage(null);
      setView("job_ready");
    } else if (
      myGreenhouseTab &&
      pageJd &&
      isMyGreenhousePartialExtract(pageJd)
    ) {
      const ghFields = sanitizeMyGreenhouseExtractedFields(pageJd.title, pageJd.company);
      setManualTitle(ghFields.title);
      setManualCompany(ghFields.company);
      setManualText("");
      setManualError(null);
      setNotOnJobMessage(
        `Found ${ghFields.title} at ${ghFields.company}. Paste the full job description below — MyGreenhouse keeps the posting inside a flex panel, so auto-capture often needs the text copied from the detail pane.`,
      );
      setView("manual_entry");
    } else {
      setNotOnJobMessage(
        tab.url && isLinkedInJobPage(tab.url)
          ? "Could not read this LinkedIn job yet. Select a job in the list, wait for the description to load, then reopen the extension."
          : tab.url && isMyGreenhouseHost(new URL(tab.url).hostname)
            ? "Could not read this MyGreenhouse job yet. Click a job in the list so the full posting is visible, then use Paste job description."
            : null,
      );
      setView("not_on_job");
    }
  }
  extractJdRef.current = _extractJD;

  function handleOpenManualEntry(options?: {
    prefillFromCaptured?: boolean;
    returnToSaved?: boolean;
  }): void {
    if ((options?.prefillFromCaptured || options?.returnToSaved) && jd) {
      setManualTitle(jd.title || "");
      setManualCompany(jd.company || "");
      setManualText("");
      setManualError(null);
      setNotOnJobMessage(
        options.returnToSaved
          ? "Wrong job description saved? Paste the correct text below, then save again."
          : "We got the wrong job description? Paste the full posting from the detail pane below, then save.",
      );
      manualEntryReturnRef.current = options.returnToSaved ? "saved" : "job_ready";
    } else {
      setManualTitle("");
      setManualCompany("");
      setManualText("");
      setManualError(null);
      setNotOnJobMessage(null);
      manualEntryReturnRef.current = "not_on_job";
    }
    setView("manual_entry");
  }

  function handleManualSubmit(): void {
    const trimmedLen = manualText.trim().length;
    if (trimmedLen < JD_MIN_LENGTH) {
      setManualError(`Paste at least ${JD_MIN_LENGTH} characters of job description text.`);
      return;
    }
    if (trimmedLen > JD_MAX_CHARS) {
      setManualError(
        `Job description exceeds ${JD_MAX_CHARS.toLocaleString()} characters. Paste only the requirements section.`,
      );
      return;
    }
    setManualError(null);
    const nextJd: ExtractedJD = {
      title: manualTitle.trim() || "Untitled Role",
      company: manualCompany.trim(),
      text: finalizeJdTextFromMaybeHtml(manualText.trim()),
      url: tabUrl ?? jd?.url ?? "",
      extraction_method: "heuristic",
    };
    setJd(nextJd);
    if (manualEntryReturnRef.current === "saved") {
      void persistSavedJd(nextJd);
      return;
    }
    setView("job_ready");
  }

  async function handleGoogleLogin(): Promise<void> {
    setGoogleLoading(true);
    setLoginError(null);
    let firefoxPending = false;

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area !== "local") return;

      // Firefox success path: service worker saved auth to storage.
      if (changes.sr_access_token?.newValue) {
        chrome.storage.onChanged.removeListener(onStorageChanged);
        setGoogleLoading(false);
        setView("loading");
        void _extractJD();
        return;
      }

      // Firefox error path: service worker wrote an error key.
      if (changes.sr_oauth_error?.newValue) {
        chrome.storage.onChanged.removeListener(onStorageChanged);
        const msg = changes.sr_oauth_error.newValue as string;
        void chrome.storage.local.remove("sr_oauth_error");
        setLoginError(msg);
        setGoogleLoading(false);
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    try {
      const result = await _sendGoogleLoginToSW();

      if (!result.success && result.pending) {
        // Firefox: OAuth running in background; storage listener handles completion.
        firefoxPending = true;
        return;
      }

      // Chrome: synchronous result from launchWebAuthFlow.
      chrome.storage.onChanged.removeListener(onStorageChanged);
      if (result.success) {
        setView("loading");
        await _extractJD();
      } else {
        setLoginError(formatApiErrorMessage(result.error, result.error));
      }
    } catch (err) {
      chrome.storage.onChanged.removeListener(onStorageChanged);
      setLoginError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      if (!firefoxPending) setGoogleLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoginError(null);
    try {
      await login(email, password);
      setView("loading");
      await _extractJD();
    } catch (err) {
      if (err instanceof ApiError) {
        setLoginError(formatApiErrorMessage(err.message, "Login failed"));
        return;
      }
      const raw = err instanceof Error ? err.message : "Login failed";
      setLoginError(formatApiErrorMessage(raw, raw));
    }
  }

  async function handleLogout(): Promise<void> {
    await logout();
    setView("login");
    setJd(null);
  }

  async function persistSavedJd(nextJd: ExtractedJD): Promise<void> {
    const token = await getAccessTokenOrNull();
    if (!token) {
      setView("login");
      return;
    }

    setView("saving");
    try {
      const result = await apiSaveJD(
        {
          url: nextJd.url,
          title: nextJd.title,
          company: nextJd.company,
          text: finalizeJdTextFromMaybeHtml(nextJd.text),
          source: "extension",
        },
        token,
      );
      setJd(nextJd);
      setSavedJdId(result.jd_id);
      setSavedExportToken(result.export_token);
      setView("saved");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Save failed");
      setView("error");
    }
  }

  async function handleSaveJD(): Promise<void> {
    if (!jd) return;
    await persistSavedJd(jd);
  }

  function handleTailorInFlintApply(): void {
    if (!savedJdId || !jd) return;
    void chrome.tabs.create({
      url: buildTailorInFlintApplyUrl(savedJdId, {
        reviewRecommended: isUncertainJdSource(jd.url, jd.extraction_method),
      }),
    });
  }

  function handlePrepInFlintDesktop(): void {
    if (!FLINT_DESKTOP_HANDOFF_ENABLED || !savedExportToken) return;

    setCopiedImportLink(false);
    // Keep both paths: direct dispatch (user gesture) + handoff tab (Chrome/Firefox/Linux).
    dispatchFlintDeepLinkFromPopup(savedExportToken);
    void openFlintDeepLinkFromPopup(savedExportToken);

    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    setFlintFallback(false);
    fallbackTimerRef.current = setTimeout(() => {
      setFlintFallback(true);
    }, FLINT_NOT_INSTALLED_TIMEOUT_MS);
  }

  async function handleCopyImportLink(): Promise<void> {
    if (!FLINT_DESKTOP_HANDOFF_ENABLED || !savedExportToken) return;
    try {
      await navigator.clipboard.writeText(buildFlintImportDeepLink(savedExportToken));
      setCopiedImportLink(true);
    } catch {
      setCopiedImportLink(false);
    }
  }

  useEffect(() => {
    void isAutofillEnabled().then(setAutofillEnabled);
  }, [view]);

  async function handleAutofillBeta(): Promise<void> {
    if (!savedJdId) return;
    setAutofillHint(null);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setAutofillHint("Open the job application tab, then try Autofill again.");
      return;
    }

    await new Promise<void>((resolve) => {
      chrome.tabs.sendMessage(
        tab.id!,
        { type: "PROBE_AUTOFILL", jdId: savedJdId },
        (response: { ok?: boolean; error?: string } | undefined) => {
          if (chrome.runtime.lastError) {
            setAutofillHint(
              isAutofillHost(tab.url)
                ? "Reload the application page, then try Autofill again."
                : "Open a supported application form (Greenhouse, Lever, Ashby, Workday, and similar), then try Autofill again.",
            );
          } else if (response?.error === "no_form") {
            setAutofillHint("Open the application form page, then try Autofill again.");
          } else if (response?.error === "Autofill disabled") {
            setAutofillHint("Autofill is turned off for this extension install.");
          } else if (response?.error === "no_sessions") {
            setAutofillHint("Tailor your resume in Flint Apply first, then try Autofill again.");
          } else if (response?.error === "dismissed") {
            setAutofillHint("Autofill was dismissed on this page — reload the tab, then try again.");
          }
          resolve();
        },
      );
    });
  }

  function renderAutofillButton(): React.ReactElement {
    const autofillPage = isAutofillHost(tabUrl);
    const linkedInJobsPage = isLinkedInHost(tabUrl) && autofillPage;
    const disabled = !autofillEnabled || !autofillPage;

    let title = "Fill the application form from your tailored resume";
    if (!autofillEnabled) {
      title = "Autofill is disabled";
    } else if (!autofillPage) {
      title =
        "Open a supported application form (Greenhouse, Lever, Ashby, Workday, and similar), then click Autofill";
    } else if (linkedInJobsPage) {
      title =
        "Heuristic autofill on LinkedIn jobs — Easy Apply modal support is best-effort, not dedicated";
    }

    return (
      <button
        type="button"
        className="btn-secondary"
        disabled={disabled}
        title={title}
        onClick={() => void handleAutofillBeta()}
      >
        Autofill (beta)
      </button>
    );
  }

  if (view === "loading") {
    return (
      <div className="popup">
        <p className="ext-version ext-version-corner">v{getExtensionVersion()}</p>
        <div className="spinner" aria-label="Loading" />
        <p className="hint hint-compact">{loadingStatus}</p>
      </div>
    );
  }

  if (view === "login") {
    return (
      <div className="popup">
        <PopupHeader />
        {GOOGLE_ENABLED && (
          <>
            <button
              type="button"
              className="btn-google"
              onClick={() => void handleGoogleLogin()}
              disabled={googleLoading}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {googleLoading ? "Signing in with Google…" : "Continue with Google"}
            </button>
            <div className="login-divider"><span>or</span></div>
          </>
        )}

        <form className="login-form" onSubmit={(e) => void handleLogin(e)}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {loginError && <p className="error-text">{loginError}</p>}
          <button type="submit" className="btn-primary">
            Log in
          </button>
        </form>
      </div>
    );
  }

  if (view === "not_on_job") {
    return (
      <div className="popup">
        <PopupHeader>
          <button className="btn-ghost" onClick={() => void handleLogout()}>
            Log out
          </button>
        </PopupHeader>
        <p className="hint">
          {notOnJobMessage ??
            "Could not detect a job on this page. Open a LinkedIn, Greenhouse, Jobright, or UKG listing — or paste the job description manually."}
        </p>
        <button className="btn-secondary" onClick={handleOpenManualEntry}>
          Paste job description
        </button>
      </div>
    );
  }

  if (view === "manual_entry") {
    const manualLen = manualText.trim().length;
    const manualOverMax = manualLen > JD_MAX_CHARS;
    const manualUnderMin = manualLen < JD_MIN_LENGTH;
    const manualReturnsToSaved = manualEntryReturnRef.current === "saved";

    return (
      <div className="popup">
        <PopupHeader>
          <button
            className="btn-ghost"
            onClick={() => {
              setNotOnJobMessage(null);
              setView(manualEntryReturnRef.current);
            }}
          >
            Back
          </button>
        </PopupHeader>
        {notOnJobMessage && <p className="hint">{notOnJobMessage}</p>}
        <div className="manual-form">
          <label>
            Job title (optional)
            <input
              type="text"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              placeholder="e.g. Senior Software Engineer"
            />
          </label>
          <label>
            Company (optional)
            <input
              type="text"
              value={manualCompany}
              onChange={(e) => setManualCompany(e.target.value)}
              placeholder="e.g. Biamp"
            />
          </label>
          <label>
            Job description *
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="Paste the full job description here…"
              rows={6}
            />
            <span
              className={`char-count${
                manualUnderMin && manualText.length > 0 ? " warn" : ""
              }${manualOverMax ? " over" : ""}`}
            >
              {manualLen.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}
              {manualUnderMin ? ` (${JD_MIN_LENGTH} min)` : ""}
            </span>
          </label>
          {manualError && <p className="error-text">{manualError}</p>}
        </div>
        <button
          className="btn-primary"
          onClick={handleManualSubmit}
          disabled={manualUnderMin || manualOverMax}
        >
          {manualReturnsToSaved ? "Save corrected description" : "Use this job description"}
        </button>
      </div>
    );
  }

  if (view === "job_ready" && jd) {
    return (
      <div className="popup">
        <PopupHeader>
          <button className="btn-ghost" onClick={() => void handleLogout()}>
            Log out
          </button>
        </PopupHeader>
        <div className="jd-preview">
          <p className="jd-title">{jd.title || "Untitled Role"}</p>
          {jd.company && <p className="jd-company">{jd.company}</p>}
          <p className="jd-method">{jd.extraction_method} extraction</p>
        </div>
        <button className="btn-primary" onClick={() => void handleSaveJD()}>
          Save job
        </button>
        <p className="hint hint-compact">
          We got the wrong job description? Paste it yourself before saving.
        </p>
        <button
          className="btn-secondary"
          onClick={() => handleOpenManualEntry({ prefillFromCaptured: true })}
        >
          Paste job description
        </button>
      </div>
    );
  }

  if (view === "saving") {
    return (
      <div className="popup">
        <div className="spinner" aria-label="Saving" />
        <p className="hint">Saving job description…</p>
      </div>
    );
  }

  if (view === "saved" && jd) {
    return (
      <div className="popup">
        <PopupHeader />
        <div className="jd-preview">
          <p className="jd-title">{jd.title || "Untitled Role"}</p>
          {jd.company && <p className="jd-company">{jd.company}</p>}
        </div>
        <button className="btn-primary" onClick={handleTailorInFlintApply}>
          Tailor in {PRODUCT_NAME}
        </button>
        <p className="hint hint-compact">
          Wrong job description? Paste the correct text and save again.
        </p>
        <button
          className="btn-secondary"
          onClick={() => handleOpenManualEntry({ returnToSaved: true })}
        >
          Paste job description
        </button>
        {renderAutofillButton()}
        {autofillHint && <p className="hint hint-compact">{autofillHint}</p>}
        <button
          type="button"
          className="btn-secondary"
          onClick={handlePrepInFlintDesktop}
          disabled={!FLINT_DESKTOP_HANDOFF_ENABLED}
          title={
            FLINT_DESKTOP_HANDOFF_ENABLED
              ? undefined
              : `${FLINT_DESKTOP_NAME} interview prep desktop app — coming soon`
          }
        >
          Prep in {FLINT_DESKTOP_NAME} (desktop)
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => void handleCopyImportLink()}
          disabled={!FLINT_DESKTOP_HANDOFF_ENABLED}
          title={
            FLINT_DESKTOP_HANDOFF_ENABLED
              ? undefined
              : "Available when the desktop interview app launches"
          }
        >
          {copiedImportLink ? "Import link copied" : "Copy import link"}
        </button>
        <p className="hint hint-compact">
          {FLINT_DESKTOP_HANDOFF_ENABLED
            ? `Tailor your resume on the web first. Use desktop for interview prep only. On Linux dev builds, run npm run deeplink:register in ${FLINT_DESKTOP_NAME} once.`
            : `Tailor your resume on the web first. ${FLINT_DESKTOP_NAME} interview prep (desktop) is coming soon.`}
        </p>
        {FLINT_DESKTOP_HANDOFF_ENABLED && flintFallback && (
          <p className="fallback-hint">
            {FLINT_DESKTOP_NAME} did not open. Register the handler (
            <code>cd Flint && npm run deeplink:register</code>
            ), ensure {FLINT_DESKTOP_NAME} or <code>npm run tauri dev</code> is running, or paste the
            copied import link into {FLINT_DESKTOP_NAME} Session Design.{" "}
            <a href={FLINT_DOWNLOAD_URL} target="_blank" rel="noreferrer">
              {FLINT_DESKTOP_NAME} on GitHub
            </a>
          </p>
        )}
      </div>
    );
  }

  if (view === "error") {
    return (
      <div className="popup">
        <PopupHeader />
        <p className="error-text">{errorMessage ?? "Something went wrong."}</p>
        <button className="btn-ghost" onClick={() => setView("job_ready")}>
          Try again
        </button>
      </div>
    );
  }

  return <div className="popup" />;
}
