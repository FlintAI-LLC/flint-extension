import { PRODUCT_NAME } from "../../src/brand.js";
import { observeApplicationSteps } from "./continuation.js";
import { detectApplicationForm, observeApplicationForm } from "./detector.js";
import type { FieldCandidate } from "./detector.js";
import { fillApplicationForm } from "./fill-engine.js";
import { fillGreenhouse } from "./greenhouse.js";
import { AutofillOverlay } from "./overlay.js";
import type { AutofillPayload, FillResult } from "./types.js";
import type { TailoredSessionOption } from "../../src/autofillApi.js";
import { isAutofillEnabled } from "../../src/autofillFlags.js";
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

/**
 * Routing decision for which fill path to use. Greenhouse keeps its dedicated
 * wrapper (selector map takes priority regardless of payload.platform); every
 * other platform — including "unknown" — goes through the shared engine using
 * whatever match source (payload selector, then detector heuristic) resolves.
 */
export function fillForPayload(
  payload: AutofillPayload,
  candidates: FieldCandidate[],
  root: ParentNode,
): FillResult {
  return payload.platform === "greenhouse"
    ? fillGreenhouse(payload, candidates, root)
    : fillApplicationForm(payload, candidates, root);
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

export function startAutofillController(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

  const hostname = window.location.hostname;
  const overlay = new AutofillOverlay({
    onAutofillConfirm: (jdId) => {
      void runAutofill(jdId);
    },
    onSessionPick: (jdId) => {
      void runAutofill(jdId);
    },
    onDismiss: () => undefined,
  });

  overlay.mount();

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
    const result = fillForPayload(response.payload, detection.fieldCandidates, document.body);

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

  function maybeOffer(
    detection = detectApplicationForm(document.body, hostname),
    preferredJdId?: string,
  ): void {
    if (!autofillEnabled) return;
    if (!detection.isApplicationForm || overlay.isDismissedForPage() || offering || filledThisStep) {
      return;
    }
    if (recentSessions.length === 0) return;

    offering = true;
    const match = matchTailoredSession(recentSessions, hostname);
    presentMatch(match, preferredJdId);
    offering = false;
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
      const detection = detectApplicationForm(document.body, hostname);
      if (!detection.isApplicationForm) {
        overlay.showMessage(
          "No application form detected",
          "Navigate to the job application form, then try Autofill again.",
        );
        sendResponse({ ok: false, error: "no_form" });
        return;
      }

      filledThisStep = false;
      maybeOffer(detection, message.jdId);
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
