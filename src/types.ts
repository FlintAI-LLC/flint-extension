export interface ExtractedJD {
  title: string;
  company: string;
  text: string;
  url: string;
  extraction_method: "structured" | "heuristic";
}

export interface StoredAuth {
  sr_access_token: string;
  sr_refresh_token: string;
  sr_expires_at: number;
  sr_user: UserInfo;
}

export interface UserInfo {
  id: string;
  email: string;
  display_name: string;
}

export interface SaveJDRequest {
  url: string;
  title: string;
  company: string;
  text: string;
  source: "extension";
}

export interface SaveJDResponse {
  jd_id: string;
  export_token: string;
  expires_in: number;
}

export interface ExtensionLoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: UserInfo;
}

export type GoogleLoginResult =
  | { success: true; user: UserInfo }
  | { success: false; error: string; pending?: false }
  | { success: false; error: ""; pending: true };

export type PopupMessage =
  | { type: "EXTRACT_JD" }
  | { type: "JD_RESULT"; jd: ExtractedJD | null }
  | { type: "JD_ERROR"; error: string }
  | { type: "GOOGLE_LOGIN" }
  | { type: "GOOGLE_LOGIN_RESULT"; result: GoogleLoginResult }
  | { type: "FETCH_PAGE_HTML"; url: string }
  | { type: "FETCH_JSON"; url: string }
  | { type: "PARSE_JD_FROM_URL"; url: string }
  | { type: "OPEN_FLINT_DEEP_LINK"; url: string }
  | { type: "INJECT_JD_EXTRACTOR"; tabId: number }
  | { type: "JD_EXTRACTOR_PING" }
  | { type: "FETCH_AUTOFILL_PAYLOAD"; jdId: string }
  | { type: "FETCH_RECENT_TAILORED_SESSIONS" }
  | { type: "PROBE_AUTOFILL"; jdId?: string }
  | { type: "EXPAND_FLOATING_PANEL" };

export type ExpandFloatingPanelResult = { ok: true } | { ok: false; error: string };

export type AutofillPayloadResult =
  | { payload: import("../content/autofill/types.js").AutofillPayload }
  | { error: string };

export type InjectJdExtractorResult = { ok: true } | { ok: false; error: string };

export type JdExtractorPingResult = { ok: true } | { ok: false };

export type FetchPageHtmlResult =
  | { html: string }
  | { error: string };

export type FetchJsonResult =
  | { json: Record<string, unknown> }
  | { error: string };

export type ParseJdFromUrlResult =
  | { jd: { title: string; company: string; text: string } | null }
  | { error: string };
