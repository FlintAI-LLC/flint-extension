import { PRODUCT_NAME } from "../../src/brand.js";
import { observeApplicationSteps } from "./continuation.js";
import { detectApplicationForm, observeApplicationForm } from "./detector.js";
import { AutofillOverlay } from "./overlay.js";
import {
  autofillWithIframeFallback,
  hasGreenhouseApplyIframe,
  installIframeAutofillListener,
} from "./iframe-bridge.js";
import type { AutofillPayload } from "./types.js";
import type { TailoredSessionOption } from "../../src/autofillApi.js";
import { isAutofillEnabled } from "../../src/autofillFlags.js";
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

function isAutofillSurface(hostname: string): boolean {
  const detection = detectApplicationForm(document.body, hostname);
  if (detection.isApplicationForm) return true;
  if (hostname !== "my.greenhouse.io") return false;
  return hasGreenhouseApplyIframe(document) || hasMyGreenhouseApplySection(document);
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

  async function runAutofill(jdId: string): Promise<void> {
    if (!autofillEnabled) return;

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

    const detection = detectApplicationForm(document.body, hostname);
    const result = await autofillWithIframeFallback(
      response.payload,
      hostname,
      detection.fieldCandidates,
      document.body,
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

  function maybeOffer(preferredJdId?: string): OfferOutcome {
    mountOverlay();
    if (!autofillEnabled) return "skipped";
    if (!isAutofillSurface(hostname)) return "not_surface";
    if (overlay.isDismissedForPage()) return "dismissed";
    if (offering || filledThisStep) return "skipped";
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
      if (!isAutofillSurface(hostname)) {
        overlay.showMessage(
          "No application form detected",
          "Open the job's apply form (scroll to Apply for this job), then try Autofill again.",
        );
        sendResponse({ ok: false, error: "no_form" });
        return;
      }

      filledThisStep = false;
      const outcome = maybeOffer(message.jdId);
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
        sendResponse({ ok: false, error: "skipped" });
        return;
      }
      sendResponse({ ok: true });
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
        if (!activeJdId) {
          maybeOffer();
          return;
        }
        void runAutofill(activeJdId);
      },
      onApplicationComplete: () => {
        overlay.hide();
        filledThisStep = false;
        activeJdId = null;
      },
    });
  });
}
