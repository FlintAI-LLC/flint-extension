export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export function extensionInvalidatedMessage(): string {
  return "Extension was reloaded. Close this panel, refresh the job page, then reopen Flint Apply.";
}
