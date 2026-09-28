import type { AutofillPayload, FillResult } from "../content/autofill/types.js";
import { FLINT_CONTENT_SOURCE } from "./panelMessages.js";

export const FLINT_RUN_AUTOFILL = "FLINT_RUN_AUTOFILL";
export const FLINT_AUTOFILL_RESULT = "FLINT_AUTOFILL_RESULT";
export const FLINT_JUMP_TO_FIELD = "FLINT_JUMP_TO_FIELD";

export interface FlintRunAutofillMessage {
  type: typeof FLINT_RUN_AUTOFILL;
  source: typeof FLINT_CONTENT_SOURCE;
  payload: AutofillPayload;
}

export interface FlintAutofillResultMessage {
  type: typeof FLINT_AUTOFILL_RESULT;
  source: typeof FLINT_CONTENT_SOURCE;
  result: FillResult;
}

export interface FlintJumpToFieldMessage {
  type: typeof FLINT_JUMP_TO_FIELD;
  source: typeof FLINT_CONTENT_SOURCE;
  selector: string;
}

export function isFlintContentMessage(data: unknown): data is { source: typeof FLINT_CONTENT_SOURCE; type: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: string }).source === FLINT_CONTENT_SOURCE &&
    typeof (data as { type?: string }).type === "string"
  );
}
