/** Cross-origin Greenhouse embed iframe ↔ top-frame autofill coordination. */

import {
  FLINT_AUTOFILL_RESULT,
  FLINT_JUMP_TO_FIELD,
  FLINT_RUN_AUTOFILL,
  isFlintContentMessage,
  type FlintAutofillResultMessage,
  type FlintJumpToFieldMessage,
  type FlintRunAutofillMessage,
} from "../../src/autofillMessages.js";
import { FLINT_CONTENT_SOURCE } from "../../src/panelMessages.js";
import { detectApplicationForm } from "./detector.js";
import type { FieldCandidate } from "./detector.js";
import { fillForPayload } from "./fill-router.js";
import { highlightFieldAtSelector } from "./field-highlight.js";
import type { AutofillPayload, FillResult } from "./types.js";
import { emptyFillResult } from "./types.js";

const IFRAME_RESULT_WAIT_MS = 4_500;

/** MyGreenhouse nests the real Greenhouse apply form in a job-boards embed iframe. */
function iframeLooksLikeGreenhouseApply(iframe: HTMLIFrameElement): boolean {
  const src = (iframe.getAttribute("src") || iframe.src || "").toLowerCase();
  if (src.includes("greenhouse.io") && (src.includes("job_app") || src.includes("/embed/"))) {
    return true;
  }
  const lazySrc = (iframe.getAttribute("data-src") || iframe.getAttribute("data-url") || "").toLowerCase();
  return lazySrc.includes("greenhouse.io") && (lazySrc.includes("job_app") || lazySrc.includes("/embed/"));
}

export function hasGreenhouseApplyIframe(doc: Document): boolean {
  return Array.from(doc.querySelectorAll("iframe")).some((iframe) => iframeLooksLikeGreenhouseApply(iframe));
}

export function scoreFillResult(result: FillResult): number {
  return result.fields.filter(
    (f) => f.status === "filled_high_confidence" || f.status === "filled_needs_review",
  ).length;
}

function broadcastToIframes(message: FlintRunAutofillMessage | FlintJumpToFieldMessage): void {
  for (const iframe of document.querySelectorAll("iframe")) {
    iframe.contentWindow?.postMessage(message, "*");
  }
}

export function broadcastRunAutofill(payload: AutofillPayload): void {
  broadcastToIframes({
    type: FLINT_RUN_AUTOFILL,
    source: FLINT_CONTENT_SOURCE,
    payload,
  });
}

export function broadcastJumpToField(selector: string): void {
  broadcastToIframes({
    type: FLINT_JUMP_TO_FIELD,
    source: FLINT_CONTENT_SOURCE,
    selector,
  });
}

/** Top frame: wait for the embed iframe content script to fill and report back. */
export function waitForIframeAutofillResults(payload: AutofillPayload): Promise<FillResult | null> {
  return new Promise((resolve) => {
    let best: FillResult | null = null;

    const onMessage = (event: MessageEvent): void => {
      if (!isFlintContentMessage(event.data) || event.data.type !== FLINT_AUTOFILL_RESULT) return;
      const result = (event.data as FlintAutofillResultMessage).result;
      if (!best || scoreFillResult(result) > scoreFillResult(best)) {
        best = result;
      }
      if (result.percent_filled >= 85) {
        cleanup();
        resolve(best);
      }
    };

    const cleanup = (): void => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(best);
    }, IFRAME_RESULT_WAIT_MS);

    window.addEventListener("message", onMessage);
    broadcastRunAutofill(payload);
  });
}

function runAutofillInThisFrame(payload: AutofillPayload, hostname: string): FillResult | null {
  const detection = detectApplicationForm(document.body, hostname);
  if (!detection.isApplicationForm) return null;
  return fillForPayload(payload, detection.fieldCandidates, document.body);
}

/** Embed iframe (and any child frame): fill when the top frame broadcasts a payload. */
export function installIframeAutofillListener(hostname: string): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (!isFlintContentMessage(event.data)) return;

    if (event.data.type === FLINT_RUN_AUTOFILL) {
      const payload = (event.data as FlintRunAutofillMessage).payload;
      const result = runAutofillInThisFrame(payload, hostname);
      if (!result || scoreFillResult(result) === 0) return;

      window.parent.postMessage(
        {
          type: FLINT_AUTOFILL_RESULT,
          source: FLINT_CONTENT_SOURCE,
          result,
        } satisfies FlintAutofillResultMessage,
        "*",
      );
      return;
    }

    if (event.data.type === FLINT_JUMP_TO_FIELD) {
      const selector = (event.data as FlintJumpToFieldMessage).selector;
      highlightFieldAtSelector(document, selector);
    }
  });
}

export async function autofillWithIframeFallback(
  payload: AutofillPayload,
  hostname: string,
  candidates: FieldCandidate[],
  root: ParentNode,
): Promise<FillResult> {
  const embedIframe = hasGreenhouseApplyIframe(document);

  let local: FillResult | null = null;
  if (!embedIframe) {
    const detection = detectApplicationForm(root as HTMLElement, hostname);
    if (detection.isApplicationForm) {
      local = fillForPayload(payload, candidates, root);
    }
  }

  if (embedIframe || !local || scoreFillResult(local) < 3) {
    const iframeResult = await waitForIframeAutofillResults(payload);
    if (iframeResult && (!local || scoreFillResult(iframeResult) > scoreFillResult(local))) {
      return iframeResult;
    }
  }

  return local ?? emptyFillResult();
}
