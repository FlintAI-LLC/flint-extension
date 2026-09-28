/** Tab hosting this popup (floating iframe) or the active browser tab. */
export async function resolveHostTab(): Promise<chrome.tabs.Tab | undefined> {
  if (chrome.tabs?.getCurrent) {
    const current = await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
      chrome.tabs.getCurrent((tab) => resolve(tab ?? undefined));
    });
    if (current?.id) {
      return current;
    }
  }

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active;
}
