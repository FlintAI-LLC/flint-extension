/** Lets the extension popup adopt a Flint Apply tab's signed-in web session. */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FLINT_EXTENSION_WEB_HANDOFF") {
    return false
  }
  void fetch("/api/auth/extension-handoff", {
    method: "POST",
    credentials: "include",
  })
    .then(async (res) => {
      if (!res.ok) {
        sendResponse(null)
        return
      }
      const data = (await res.json()) as { code?: string } | null
      sendResponse(data?.code ? { code: data.code } : null)
    })
    .catch(() => sendResponse(null))
  return true
})
