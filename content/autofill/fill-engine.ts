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
): { el: Element | null; matchSource: MatchSource } {
  const mapped = selectorForKey(platform, key);
  if (mapped) {
    const el = querySelectorDeep(root, mapped);
    if (el) return { el, matchSource: "selector_map" };
  }

  if (payloadSelector) {
    const el = querySelectorDeep(root, payloadSelector);
    if (el) return { el, matchSource: "payload" };
  }

  const heuristic = candidateSelectorForKey(candidates, key);
  if (heuristic) {
    const el = querySelectorDeep(root, heuristic);
    if (el) return { el, matchSource: "heuristic" };
  }

  return { el: null, matchSource: "heuristic" };
}

function writeFieldValue(el: Element, value: string): boolean {
  if (el instanceof HTMLInputElement && el.type.toLowerCase() === "file") {
    return false;
  }
  if (el instanceof HTMLSelectElement) {
    return setSelectByVisibleText(el, value);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setTextControlValue(el, value);
    return true;
  }
  return false;
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
    const { el, matchSource } = resolveElement(root, platform, field.key, field.selector, candidates);
    const reportedSelector = selectorForKey(platform, field.key) ?? field.selector;

    if (!el) {
      fields.push({ key: field.key, selector: field.selector || null, status: "not_found" });
      continue;
    }

    const isFile = el instanceof HTMLInputElement && el.type.toLowerCase() === "file";
    if (isFile) {
      fields.push({ key: field.key, selector: reportedSelector, status: "not_applicable_file_upload" });
      continue;
    }

    const written = writeFieldValue(el, field.value);
    if (!written) {
      fields.push({ key: field.key, selector: reportedSelector, status: "not_found" });
      continue;
    }

    fields.push({
      key: field.key,
      selector: reportedSelector,
      status: statusForMatch(matchSource, false),
      value_preview: previewValue(field.value),
    });
  }

  return { fields, percent_filled: computePercentFilled(fields) };
}
