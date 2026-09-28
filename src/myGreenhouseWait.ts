import { collectGreenhouseBoardJobRefs } from "./greenhouseBoardsApi.js";
import { readListClickMyGreenhouseJobContext } from "./myGreenhouseContext.js";
import {
  findSelectedJobListItem,
  isPlausibleJobHeader,
  resolveMyGreenhouseSelection,
} from "./myGreenhouseExtract.js";

export interface MyGreenhouseWaitResult {
  ready: boolean;
  reason: string;
  refCount: number;
  hasSelection: boolean;
  waitedMs: number;
}

const MIN_WAIT_BEFORE_HEADER_MS = 2_500;

/** Poll until embed refs or a trustworthy job selection appear. */
export async function waitForMyGreenhouseJobContext(
  doc: Document,
  maxWaitMs = 10_000,
): Promise<MyGreenhouseWaitResult> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const elapsed = Date.now() - start;

    const clickCtx = readListClickMyGreenhouseJobContext();
    const listSelected = findSelectedJobListItem(doc);
    const resolved = resolveMyGreenhouseSelection(doc);
    if (resolved && isPlausibleJobHeader(resolved.title, resolved.company)) {
      const fromClick =
        clickCtx &&
        clickCtx.title === resolved.title &&
        clickCtx.company === resolved.company;
      const fromList =
        listSelected &&
        listSelected.title === resolved.title &&
        listSelected.company === resolved.company;
      if (fromClick) {
        return {
          ready: true,
          reason: "list-click",
          refCount: 0,
          hasSelection: true,
          waitedMs: elapsed,
        };
      }
      if (fromList) {
        return {
          ready: true,
          reason: "list",
          refCount: 0,
          hasSelection: true,
          waitedMs: elapsed,
        };
      }
      if (elapsed >= MIN_WAIT_BEFORE_HEADER_MS) {
        return {
          ready: true,
          reason: "header",
          refCount: 0,
          hasSelection: true,
          waitedMs: elapsed,
        };
      }
    }

    const refCount = collectGreenhouseBoardJobRefs(doc).length;
    if (refCount > 0) {
      const resolved = resolveMyGreenhouseSelection(doc);
      return {
        ready: true,
        reason: "refs",
        refCount,
        hasSelection: Boolean(resolved),
        waitedMs: elapsed,
      };
    }

    if (elapsed >= MIN_WAIT_BEFORE_HEADER_MS) {
      const resolved = resolveMyGreenhouseSelection(doc);
      if (
        resolved &&
        isPlausibleJobHeader(resolved.title, resolved.company)
      ) {
        return {
          ready: true,
          reason: "header",
          refCount,
          hasSelection: true,
          waitedMs: elapsed,
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    ready: false,
    reason: "timeout",
    refCount: collectGreenhouseBoardJobRefs(doc).length,
    hasSelection: Boolean(resolveMyGreenhouseSelection(doc)),
    waitedMs: Date.now() - start,
  };
}
