export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export function isExtensionContextInvalidatedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("extension context invalidated") || msg.includes("context invalidated");
}

export function extensionInvalidatedMessage(): string {
  return "Extension was reloaded. Close this panel, refresh the job page, then reopen Flint Apply.";
}

/** Attach to fire-and-forget async work in content scripts so reload does not spam the console. */
export function voidUnlessContextInvalidated(promise: Promise<unknown>): void {
  void promise.catch((err) => {
    if (isExtensionContextInvalidatedError(err)) return;
    console.error("[FlintApply]", err);
  });
}
