/** Extension version from manifest (bump manifest.json + package.json together). */
export function getExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "unknown";
  }
}
