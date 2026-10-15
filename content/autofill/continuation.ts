import { collectInputElements } from "./detector.js";

export type StepChangeReason = "history" | "mutation";

export interface StepChangeContext {
  url: string;
  reason: StepChangeReason;
}

export interface ApplicationContinuationOptions {
  root?: ParentNode;
  hostname?: string;
  debounceMs?: number;
  onStepChange: (ctx: StepChangeContext) => void;
  onApplicationComplete?: () => void;
}

const COMPLETION_PATTERNS = [
  /thank you/i,
  /application submitted/i,
  /we(?:'|’)ve received/i,
  /submission received/i,
  /successfully submitted/i,
];

function formStructureSignature(root: ParentNode): string {
  const parts: string[] = [];
  // Same walk as the detector, so a step change inside a shadow root is seen.
  for (const el of collectInputElements(root)) {
    const htmlEl = el as HTMLElement;
    parts.push(
      [
        htmlEl.tagName.toLowerCase(),
        htmlEl.getAttribute("name") ?? "",
        htmlEl.getAttribute("id") ?? "",
        htmlEl.getAttribute("type") ?? "",
      ].join("|"),
    );
  }
  return parts.sort().join(";");
}

function pageHasCompletionCopy(root: ParentNode): boolean {
  const text = root.textContent ?? "";
  return COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isApplicationComplete(root: ParentNode, _hostname = ""): boolean {
  // Only explicit completion copy means done. Treating a detection miss as
  // completion made every unrecognised step (all of Workday) hide the overlay
  // and clear the active session on each mutation.
  return pageHasCompletionCopy(root);
}

export function observeApplicationSteps(options: ApplicationContinuationOptions): () => void {
  const root = options.root ?? document;
  const hostname =
    options.hostname ??
    (typeof globalThis.location !== "undefined" ? globalThis.location.hostname : "");
  const debounceMs = options.debounceMs ?? 350;

  let lastSignature = formStructureSignature(root);
  let lastUrl = typeof globalThis.location !== "undefined" ? globalThis.location.href : "";
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const maybeComplete = (): void => {
    if (destroyed) return;
    if (isApplicationComplete(root, hostname)) {
      options.onApplicationComplete?.();
    }
  };

  const emitIfChanged = (reason: StepChangeReason): void => {
    if (destroyed) return;
    const currentUrl =
      typeof globalThis.location !== "undefined" ? globalThis.location.href : lastUrl;
    const signature = formStructureSignature(root);
    const urlChanged = currentUrl !== lastUrl;
    const structureChanged = signature !== lastSignature;

    if (!urlChanged && !structureChanged) return;

    lastUrl = currentUrl;
    lastSignature = signature;

    if (isApplicationComplete(root, hostname)) {
      options.onApplicationComplete?.();
      return;
    }

    options.onStepChange({ url: currentUrl, reason });
  };

  const schedule = (reason: StepChangeReason): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => emitIfChanged(reason), debounceMs);
  };

  const onPopState = (): void => schedule("history");
  globalThis.addEventListener("popstate", onPopState);

  const historyProto = History.prototype as History & {
    __flintPatched?: boolean;
  };
  const originalPushState = historyProto.pushState.bind(globalThis.history);
  const originalReplaceState = historyProto.replaceState.bind(globalThis.history);

  if (!historyProto.__flintPatched) {
    historyProto.pushState = (...args: Parameters<History["pushState"]>) => {
      originalPushState(...args);
      schedule("history");
    };
    historyProto.replaceState = (...args: Parameters<History["replaceState"]>) => {
      originalReplaceState(...args);
      schedule("history");
    };
    historyProto.__flintPatched = true;
  }

  const mutationObserver = new MutationObserver(() => schedule("mutation"));
  const observeTarget = root === document ? document.documentElement : root;
  mutationObserver.observe(observeTarget, { childList: true, subtree: true });

  maybeComplete();

  return () => {
    destroyed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    globalThis.removeEventListener("popstate", onPopState);
    mutationObserver.disconnect();
  };
}
