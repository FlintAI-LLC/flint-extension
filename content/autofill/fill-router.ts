import type { FieldCandidate } from "./detector.js";
import { fillApplicationForm } from "./fill-engine.js";
import { fillGreenhouse } from "./greenhouse.js";
import type { AutofillPayload, FillResult } from "./types.js";

/**
 * Greenhouse keeps its dedicated wrapper; every other platform uses the shared
 * engine with payload/heuristic resolution.
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
