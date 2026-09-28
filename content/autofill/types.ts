/** Autofill types — confidence-scored fill outcomes (autofill v1). */

export type FieldFillStatus =
  | "filled_high_confidence"
  | "filled_needs_review"
  | "not_found"
  | "not_applicable_file_upload";

export interface FieldFillOutcome {
  key: string;
  selector: string | null;
  status: FieldFillStatus;
  value_preview?: string;
}

export interface FillResult {
  fields: FieldFillOutcome[];
  percent_filled: number;
}

export interface AutofillFieldPayload {
  key: string;
  selector: string;
  value: string;
  label?: string;
}

export interface AutofillPayload {
  jd_id: string;
  platform: "greenhouse" | "linkedin" | "lever" | "ashby" | "workday" | "unknown";
  fields: AutofillFieldPayload[];
}

export function computePercentFilled(fields: FieldFillOutcome[]): number {
  const applicable = fields.filter((f) => f.status !== "not_applicable_file_upload");
  if (applicable.length === 0) return 0;
  const filled = applicable.filter(
    (f) => f.status === "filled_high_confidence" || f.status === "filled_needs_review",
  ).length;
  return Math.round((filled / applicable.length) * 100);
}

export function countHighConfidenceFilled(fields: FieldFillOutcome[]): number {
  return fields.filter((f) => f.status === "filled_high_confidence").length;
}

export function emptyFillResult(): FillResult {
  return { fields: [], percent_filled: 0 };
}

export function previewValue(value: string, maxLen = 24): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}
