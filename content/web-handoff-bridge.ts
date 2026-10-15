import {
  buildPresenceResponse,
  shouldHandlePresenceMessage,
} from "./extensionPresenceBridge.js";

/** Lets the extension popup adopt a Flint Apply tab's signed-in web session. */

window.addEventListener("message", (event: MessageEvent) => {
  const request = shouldHandlePresenceMessage({
    origin: event.origin,
    source: event.source,
    data: event.data,
    pageOrigin: window.location.origin,
    pageWindow: window,
  });
  if (!request) return;
  window.postMessage(
    buildPresenceResponse(request.requestId, chrome.runtime.getManifest().version),
    window.location.origin,
  );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FLINT_EXTENSION_WEB_HANDOFF") {
    return false
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  void fetch("/api/auth/extension-handoff", {
    method: "POST",
    credentials: "include",
    signal: controller.signal,
  })
    .then(async (res) => {
      clearTimeout(timeout)
      if (!res.ok) {
        sendResponse(null)
        return
      }
      const data = (await res.json()) as { code?: string } | null
      sendResponse(data?.code ? { code: data.code } : null)
    })
    .catch(() => {
      clearTimeout(timeout)
      sendResponse(null)
    })
  return true
})
