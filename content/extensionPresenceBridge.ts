export const FLINT_APPLY_WEB_SOURCE = "flintapply-web";
export const FLINT_EXTENSION_SOURCE = "flint-extension";
export const FLINT_EXTENSION_PRESENCE_REQUEST = "FLINT_EXTENSION_PRESENCE_REQUEST";
export const FLINT_EXTENSION_PRESENCE_RESPONSE = "FLINT_EXTENSION_PRESENCE_RESPONSE";

export type PresenceRequest = {
  source: string;
  type: string;
  requestId: string;
};

export function parsePresenceRequest(data: unknown): PresenceRequest | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.source !== FLINT_APPLY_WEB_SOURCE) return null;
  if (record.type !== FLINT_EXTENSION_PRESENCE_REQUEST) return null;
  if (typeof record.requestId !== "string" || !record.requestId) return null;
  return {
    source: record.source,
    type: record.type,
    requestId: record.requestId,
  };
}

export function buildPresenceResponse(requestId: string, version: string) {
  return {
    source: FLINT_EXTENSION_SOURCE,
    type: FLINT_EXTENSION_PRESENCE_RESPONSE,
    requestId,
    version,
  };
}

export function shouldHandlePresenceMessage(event: {
  origin: string;
  source: unknown;
  data: unknown;
  pageOrigin: string;
  pageWindow: unknown;
}): PresenceRequest | null {
  if (event.origin !== event.pageOrigin) return null;
  if (event.source !== event.pageWindow) return null;
  return parsePresenceRequest(event.data);
}
