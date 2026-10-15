/** Shared fill engine — resolves DOM elements per payload field and writes values. */

import selectorsConfig from "./selectors.json";
import { FIELD_KEY_TO_CONCEPT } from "./detector.js";
import type { FieldCandidate, Platform } from "./detector.js";
import {
  querySelectorDeep,
  setSelectByVisibleText,
  setTextControlValue,
} from "./fill-utils.js";
import type {
  AutofillPayload,
  FieldFillOutcome,
  FieldFillStatus,
  FillResult,
} from "./types.js";
import { computePercentFilled, previewValue } from "./types.js";

interface SelectorField {
  key: string;
  selector: string;
}

interface SelectorsFile {
  greenhouse: { fields: SelectorField[] };
  linkedin: { fields: SelectorField[] };
}

type MatchSource = "selector_map" | "payload" | "heuristic";

export interface FillEngineOptions {
  /** Force which platform's selector map to consult, overriding payload.platform. */
  preferSelectorMap?: Platform;
}

function selectorMapFieldsForPlatform(platform: Platform): SelectorField[] {
  const config = selectorsConfig as SelectorsFile;
  if (platform === "greenhouse") return config.greenhouse.fields;
  if (platform === "linkedin") return config.linkedin.fields;
  return [];
}

function selectorForKey(platform: Platform, key: string): string | null {
  return selectorMapFieldsForPlatform(platform).find((f) => f.key === key)?.selector ?? null;
}

function candidateSelectorForKey(candidates: FieldCandidate[], key: string): string | null {
  const concept = FIELD_KEY_TO_CONCEPT[key];
  if (!concept) return null;
  return candidates.find((c) => c.concept === concept)?.selector ?? null;
}

function resolveElement(
  root: ParentNode,
  platform: Platform,
  key: string,
  payloadSelector: string,
  candidates: FieldCandidate[],
): { el: Element | null; matchSource: MatchSource; selector: string | null } {
  const mapped = selectorForKey(platform, key);
  if (mapped) {
    const el = querySelectorDeep(root, mapped);
    if (el) return { el, matchSource: "selector_map", selector: mapped };
  }

  if (payloadSelector) {
    const el = querySelectorDeep(root, payloadSelector);
    if (el) return { el, matchSource: "payload", selector: payloadSelector };
  }

  const heuristic = candidateSelectorForKey(candidates, key);
  if (heuristic) {
    const el = querySelectorDeep(root, heuristic);
    if (el) return { el, matchSource: "heuristic", selector: heuristic };
  }

  return { el: null, matchSource: "heuristic", selector: null };
}

/**
 * Loose match: the written value is accepted as long as it actually landed
 * in the control. Framework-controlled inputs (React etc.) sometimes revert
 * a programmatic write back to their own tracked state — this is what lets
 * us tell "it stuck" from "it silently bounced", instead of always trusting
 * our own write call.
 */
function valueWasAccepted(actual: string, expected: string): boolean {
  const a = actual.trim().toLowerCase();
  const e = expected.trim().toLowerCase();
  if (!e) return true;
  if (!a) return false;
  return a === e || a.includes(e) || e.includes(a);
}

interface WriteOutcome {
  attempted: boolean;
  verified: boolean;
}

function writeFieldValue(el: Element, value: string): WriteOutcome {
  if (el instanceof HTMLInputElement && el.type.toLowerCase() === "file") {
    return { attempted: false, verified: false };
  }
  if (el instanceof HTMLSelectElement) {
    // Compare against the option's own `.value` (what we actually set), not
    // the free-text `value` we were given — an option's value attribute
    // commonly differs from its visible text (`<option value="US">United
    // States of America</option>`), and loosely comparing against the free
    // text would misreport a correct selection as rejected.
    const matchedValue = setSelectByVisibleText(el, value);
    if (matchedValue === null) return { attempted: false, verified: false };
    return { attempted: true, verified: el.value === matchedValue };
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setTextControlValue(el, value);
    return { attempted: true, verified: valueWasAccepted(el.value, value) };
  }
  return { attempted: false, verified: false };
}

function statusForMatch(matchSource: MatchSource, isFileInput: boolean): FieldFillStatus {
  if (isFileInput) return "not_applicable_file_upload";
  if (matchSource === "selector_map" || matchSource === "payload") {
    return "filled_high_confidence";
  }
  return "filled_needs_review";
}

/**
 * Shared fill engine used by all platform wrappers. Resolution order per field:
 * selector map -> payload selector -> detector heuristic candidate -> not_found.
 * File inputs are always reported as not_applicable_file_upload, never written to.
 */
export function fillApplicationForm(
  payload: AutofillPayload,
  candidates: FieldCandidate[] = [],
  root: ParentNode = document,
  options: FillEngineOptions = {},
): FillResult {
  const platform = options.preferSelectorMap ?? payload.platform;
  const fields: FieldFillOutcome[] = [];

  for (const field of payload.fields) {
    const { el, matchSource, selector: resolvedSelector } = resolveElement(
      root,
      platform,
      field.key,
      field.selector,
      candidates,
    );
    // Report the selector that actually resolved the element, never a
    // static map entry that didn't match — a stale reported selector is
    // exactly what makes "jump to field" target nothing on pages whose DOM
    // has drifted from the selector map (e.g. a redesigned ATS layout).
    const reportedSelector = resolvedSelector ?? (field.selector || null);

    if (!el) {
      fields.push({ key: field.key, selector: reportedSelector, status: "not_found" });
      continue;
    }

    const isFile = el instanceof HTMLInputElement && el.type.toLowerCase() === "file";
    if (isFile) {
      fields.push({ key: field.key, selector: reportedSelector, status: "not_applicable_file_upload" });
      continue;
    }

    const outcome = writeFieldValue(el, field.value);
    if (!outcome.attempted) {
      fields.push({ key: field.key, selector: reportedSelector, status: "not_found" });
      continue;
    }
    if (!outcome.verified) {
      // We wrote to the right element but the page did not keep the value
      // (e.g. a controlled component bounced it back to empty). Never report
      // this as filled — the percentage must reflect what actually landed.
      fields.push({
        key: field.key,
        selector: reportedSelector,
        status: "fill_rejected",
        value_preview: previewValue(field.value),
      });
      continue;
    }

    fields.push({
      key: field.key,
      selector: reportedSelector,
      status: statusForMatch(matchSource, false),
      value_preview: previewValue(field.value),
    });
  }

  applyCombinedNameFallback(fields, payload, candidates, root);

  return { fields, percent_filled: computePercentFilled(fields) };
}

/**
 * Some ATS forms — and the generic/unknown-platform heuristic path — expose
 * a single combined "Full Name" field instead of separate first/last
 * inputs. The detector keeps a dedicated "name" concept for exactly this
 * case, but first_name/last_name never resolve to it on their own (each
 * only matches its own concept), so without this fallback such a form is
 * silently left with an empty name instead of filled. Mutates `fields` in
 * place when (and only when) both keys came back not_found and a combined
 * field is actually present.
 */
function applyCombinedNameFallback(
  fields: FieldFillOutcome[],
  payload: AutofillPayload,
  candidates: FieldCandidate[],
  root: ParentNode,
): void {
  const firstIdx = fields.findIndex((f) => f.key === "first_name");
  const lastIdx = fields.findIndex((f) => f.key === "last_name");
  if (firstIdx === -1 || lastIdx === -1) return;
  if (fields[firstIdx].status !== "not_found" || fields[lastIdx].status !== "not_found") return;

  const combinedCandidate = candidates.find((c) => c.concept === "name");
  if (!combinedCandidate) return;
  const el = querySelectorDeep(root, combinedCandidate.selector);
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;

  const firstValue = payload.fields.find((f) => f.key === "first_name")?.value ?? "";
  const lastValue = payload.fields.find((f) => f.key === "last_name")?.value ?? "";
  const combinedValue = `${firstValue} ${lastValue}`.trim();
  if (!combinedValue) return;

  setTextControlValue(el, combinedValue);
  const status: FieldFillStatus = valueWasAccepted(el.value, combinedValue)
    ? "filled_needs_review"
    : "fill_rejected";
  const preview = previewValue(combinedValue);
  fields[firstIdx] = {
    key: "first_name",
    selector: combinedCandidate.selector,
    status,
    value_preview: preview,
  };
  fields[lastIdx] = {
    key: "last_name",
    selector: combinedCandidate.selector,
    status,
    value_preview: preview,
  };
}
