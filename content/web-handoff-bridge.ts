/** Lets the extension popup adopt a Flint Apply tab's signed-in web session. */

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
