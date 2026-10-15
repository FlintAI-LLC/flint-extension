import { describe, expect, it } from "vitest";
import {
  FLINT_APPLY_WEB_SOURCE,
  FLINT_EXTENSION_PRESENCE_REQUEST,
  buildPresenceResponse,
  parsePresenceRequest,
  shouldHandlePresenceMessage,
} from "../../content/extensionPresenceBridge.js";

describe("extension presence bridge", () => {
  it("responds to a valid presence request", () => {
    const requestId = "req-123";
    const parsed = parsePresenceRequest({
      source: FLINT_APPLY_WEB_SOURCE,
      type: FLINT_EXTENSION_PRESENCE_REQUEST,
      requestId,
    });
    expect(parsed?.requestId).toBe(requestId);

    const response = buildPresenceResponse(requestId, "0.1.41");
    expect(response.requestId).toBe(requestId);
    expect(response.version).toBe("0.1.41");
  });

  it("ignores wrong source, type, or missing requestId", () => {
    expect(
      parsePresenceRequest({
        source: "other",
        type: FLINT_EXTENSION_PRESENCE_REQUEST,
        requestId: "x",
      }),
    ).toBeNull();
    expect(
      parsePresenceRequest({
        source: FLINT_APPLY_WEB_SOURCE,
        type: "WRONG",
        requestId: "x",
      }),
    ).toBeNull();
    expect(
      parsePresenceRequest({
        source: FLINT_APPLY_WEB_SOURCE,
        type: FLINT_EXTENSION_PRESENCE_REQUEST,
      }),
    ).toBeNull();
  });

  it("ignores messages when event.source !== window", () => {
    const pageWindow = {};
    const result = shouldHandlePresenceMessage({
      origin: "https://flintapply.com",
      source: {},
      data: {
        source: FLINT_APPLY_WEB_SOURCE,
        type: FLINT_EXTENSION_PRESENCE_REQUEST,
        requestId: "abc",
      },
      pageOrigin: "https://flintapply.com",
      pageWindow,
    });
    expect(result).toBeNull();
  });

  it("accepts same-window messages with matching origin", () => {
    const pageWindow = { id: "window" };
    const result = shouldHandlePresenceMessage({
      origin: "http://localhost:3100",
      source: pageWindow,
      data: {
        source: FLINT_APPLY_WEB_SOURCE,
        type: FLINT_EXTENSION_PRESENCE_REQUEST,
        requestId: "abc",
      },
      pageOrigin: "http://localhost:3100",
      pageWindow,
    });
    expect(result?.requestId).toBe("abc");
  });
});
