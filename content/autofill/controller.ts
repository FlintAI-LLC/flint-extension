import { PRODUCT_NAME } from "../../src/brand.js";
import { observeApplicationSteps } from "./continuation.js";
import { detectApplicationForm, observeApplicationForm } from "./detector.js";
import {
  resolveAutofillSurface,
  resolveAutofillSurfaceWithRetry,
  type ResolvedAutofillSurface,
} from "./surface-root.js";
import { AutofillOverlay } from "./overlay.js";
import {
  autofillWithIframeFallback,
  hasGreenhouseApplyIframe,
  installIframeAutofillListener,
} from "./iframe-bridge.js";
import type { AutofillPayload } from "./types.js";
import type { TailoredSessionOption } from "../../src/autofillApi.js";
import { isAutofillEnabled, isWorkdayApplyUrl } from "../../src/autofillFlags.js";
import {
  findMyGreenhouseUiMountRoot,
  reparentFlintUiHost,
} from "../../src/myGreenhouseUiMount.js";
import { pickSessionMatch as matchTailoredSession } from "../../src/sessionMatcher.js";

interface RecentSessionsResponse {
  sessions?: TailoredSessionOption[];
  error?: string;
}

interface AutofillPayloadResponse {
  payload?: AutofillPayload;
  error?: string;
  code?: string;
}

interface ProbeAutofillMessage {
  type: "PROBE_AUTOFILL";
  jdId?: string;
}

function hasMyGreenhouseApplySection(doc: Document): boolean {
  const headings = doc.querySelectorAll("h1, h2, h3, h4, [role='heading']");
  for (const heading of Array.from(headings)) {
    if (/apply for this job/i.test(heading.textContent ?? "")) return true;
  }
  return false;
}

function getAutofillSurface(doc: Document, host: string): ResolvedAutofillSurface | null {
  const resolved = resolveAutofillSurface(doc, host);
  if (resolved) return resolved;
  if (host !== "my.greenhouse.io") return null;
  if (!hasGreenhouseApplyIframe(doc) && !hasMyGreenhouseApplySection(doc)) return null;
  return { root: doc.body, detection: detectApplicationForm(doc.body, host) };
}

function isAutofillSurface(doc: Document, host: string): boolean {
  return getAutofillSurface(doc, host) !== null;
}

export type StepChangeAction = "offer" | "refill" | "abandon";

/**
 * What to do when the page structure changes mid-application.
 *
 * `abandon` is the security-critical case: once a fill has been confirmed we
 * hold an active session, and an SPA navigation to a search, login or profile
 * page must drop it rather than silently writing the user's details into
 * whatever fields happen to be there.
 */
export function decideStepChangeAction(
  activeJdId: string | null,
  isSurface: boolean,
): StepChangeAction {
  if (!activeJdId) return "offer";
  if (!isSurface) return "abandon";
  return "refill";
}

function requestRecentSessions(): Promise<TailoredSessionOption[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "FETCH_RECENT_TAILORED_SESSIONS" }, (res: RecentSessionsResponse | undefined) => {
      if (chrome.runtime.lastError || !res || res.error) {
        resolve([]);
        return;
      }
      resolve(res.sessions ?? []);
    });
  });
}

function requestAutofillPayload(jdId: string): Promise<AutofillPayloadResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "FETCH_AUTOFILL_PAYLOAD", jdId }, (res: AutofillPayloadResponse | undefined) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message ?? "Extension unavailable" });
        return;
      }
      resolve(res ?? { error: "No response" });
    });
  });
}

export function autofillFailureMessage(response: AutofillPayloadResponse): string {
  if (response.code === "not_authenticated") {
    return `Sign in to the ${PRODUCT_NAME} extension, then try Autofill again.`;
  }
  if (response.code === "not_found") {
    return "Saved job not found. Save the job in the extension again.";
  }
  if (response.code === "network") {
    return `Could not reach ${PRODUCT_NAME}. Check your connection and try again.`;
  }
  return (
    "Autofill is unavailable right now. Tailor your resume in Flint Apply first, then try again."
  );
}

type OfferOutcome = "shown" | "no_sessions" | "dismissed" | "not_surface" | "skipped";

export function startAutofillController(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

  const hostname = window.location.hostname;

  // Every frame listens for fill/jump broadcasts; only the top frame owns the overlay UI.
  installIframeAutofillListener(hostname);
  if (window !== window.top) return;

  const overlay = new AutofillOverlay({
    onAutofillConfirm: (jdId) => {
      void runAutofill(jdId);
    },
    onSessionPick: (jdId) => {
      void runAutofill(jdId);
    },
    onDismiss: () => undefined,
  });

  const mountOverlay = (): void => {
    const root = findMyGreenhouseUiMountRoot() ?? document.body;
    overlay.mount(root);
    const host = overlay.getHost();
    if (host) reparentFlintUiHost(host);
  };
  mountOverlay();

  let recentSessions: TailoredSessionOption[] = [];
  let activeJdId: string | null = null;
  let offering = false;
  let filledThisStep = false;
  let autofillEnabled = true;

  void isAutofillEnabled().then((enabled) => {
    autofillEnabled = enabled;
  });

  async function refreshSessions(): Promise<void> {
    recentSessions = await requestRecentSessions();
  }

  async function runAutofill(jdId: string, options?: { delayMs?: number }): Promise<void> {
    if (!autofillEnabled) return;

    if (options?.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    activeJdId = jdId;
    const response = await requestAutofillPayload(jdId);
    if (response.code === "not_tailored") {
      overlay.showMessage(
        "Resume not tailored yet",
        `Open this job in ${PRODUCT_NAME}, tailor your resume, then return to the application form.`,
      );
      return;
    }
    if (!response.payload) {
      overlay.showMessage("Autofill unavailable", autofillFailureMessage(response));
      return;
    }

    const surface = getAutofillSurface(document, hostname);
    if (!surface) {
      overlay.showMessage(
        "No application form detected",
        "Wait for the form to finish loading, then try Autofill again.",
      );
      return;
    }
    const result = await autofillWithIframeFallback(
      response.payload,
      hostname,
      surface.detection.fieldCandidates,
      surface.root,
    );

    filledThisStep = true;
    overlay.showResult(result);
  }

  function presentMatch(
    match: ReturnType<typeof matchTailoredSession>,
    preferredJdId?: string,
  ): void {
    if (preferredJdId) {
      const preferred = recentSessions.find((session) => session.jd_id === preferredJdId);
      if (preferred) {
        overlay.showOffer(
          { title: preferred.title, company: preferred.company },
          preferred.jd_id,
        );
        return;
      }
    }

    if (match.kind === "single") {
      overlay.showOffer(
        { title: match.session.title, company: match.session.company },
        match.session.jd_id,
      );
      return;
    }

    if (match.kind === "picker") {
      overlay.showPicker(match.sessions);
    }
  }

  function maybeOffer(preferredJdId?: string, force = false): OfferOutcome {
    mountOverlay();
    if (!autofillEnabled) return "skipped";
    if (!isAutofillSurface(document, hostname)) return "not_surface";
    if (overlay.isDismissedForPage()) return "dismissed";
    if (!force && (offering || filledThisStep)) return "skipped";
    if (recentSessions.length === 0) return "no_sessions";

    offering = true;
    const match = matchTailoredSession(recentSessions, hostname);
    presentMatch(match, preferredJdId);
    offering = false;
    return "shown";
  }

  chrome.runtime.onMessage.addListener((message: ProbeAutofillMessage, _sender, sendResponse) => {
    if (message.type !== "PROBE_AUTOFILL") return false;

    void (async () => {
      autofillEnabled = await isAutofillEnabled();
      if (!autofillEnabled) {
        sendResponse({ ok: false, error: "Autofill disabled" });
        return;
      }

      await refreshSessions();
      mountOverlay();
      const surface = await resolveAutofillSurfaceWithRetry(document, hostname, {
        attempts: 6,
        delayMs: 400,
      });
      if (!surface && !isAutofillSurface(document, hostname)) {
        overlay.showMessage(
          "No application form detected",
          "Wait for the Workday form to finish loading (name and email fields visible), then try Autofill again.",
        );
        sendResponse({ ok: false, error: "no_form" });
        return;
      }

      filledThisStep = false;
      offering = false;
      const outcome = maybeOffer(message.jdId, true);
      if (outcome === "no_sessions") {
        overlay.showMessage(
          "No tailored resume yet",
          `Tailor your resume for this job in ${PRODUCT_NAME}, then return here and click Autofill again.`,
        );
        sendResponse({ ok: false, error: "no_sessions" });
        return;
      }
      if (outcome === "dismissed") {
        overlay.showMessage(
          "Autofill dismissed",
          "You dismissed autofill on this page earlier. Reload the tab to see the prompt again.",
        );
        sendResponse({ ok: false, error: "dismissed" });
        return;
      }
      if (outcome === "not_surface") {
        overlay.showMessage(
          "No application form detected",
          "Open the job's apply form (scroll to Apply for this job), then try Autofill again.",
        );
        sendResponse({ ok: false, error: "no_form" });
        return;
      }
      if (outcome === "skipped") {
        overlay.showMessage(
          "Autofill is waiting",
          "If you already filled this step, advance to the next page or reload and try again.",
        );
        sendResponse({ ok: false, error: "skipped" });
        return;
      }
      sendResponse({ ok: true, hint: "Check the Flint panel at the bottom-right of the page." });
    })();

    return true;
  });

  void refreshSessions().then(() => {
    observeApplicationForm(() => {
      maybeOffer();
    }, { hostname });

    observeApplicationSteps({
      hostname,
      onStepChange: () => {
        filledThisStep = false;
        const pageUrl = window.location.href;
        const onWorkdayApply = isWorkdayApplyUrl(pageUrl);
        const surface = isAutofillSurface(document, hostname);
        // Surface is re-verified on every step change: completion copy no
        // longer clears activeJdId, so this is what stops an SPA navigation
        // from autofilling a non-application page.
        const action = decideStepChangeAction(activeJdId, activeJdId ? surface : false);
        if (action === "offer") {
          maybeOffer();
          return;
        }
        if (action === "abandon") {
          // Workday "My Experience" and similar steps have no name/email fields,
          // so detection returns false — but we are still inside /apply/. Do not
          // drop the session or leave the step-1 result panel frozen.
          if (activeJdId && onWorkdayApply) {
            overlay.showMessage(
              "New application step",
              "Flint only autofills contact fields from your tailored resume today — not work history, resume upload, or dropdowns like “How did you hear about us?”. Fill this step manually, or click Autofill (beta) again if contact fields appear.",
            );
            return;
          }
          overlay.hide();
          activeJdId = null;
          return;
        }
        void runAutofill(activeJdId as string, { delayMs: onWorkdayApply ? 700 : 0 });
      },
      onApplicationComplete: () => {
        overlay.hide();
        filledThisStep = false;
        activeJdId = null;
      },
    });
  });
}
