import { detectApplicationForm, type DetectionResult } from "./detector.js";

export interface ResolvedAutofillSurface {
  root: ParentNode;
  detection: DetectionResult;
}

function surfaceScore(detection: DetectionResult): number {
  if (!detection.isApplicationForm) return -1;
  return detection.confidence + detection.fieldCandidates.length * 0.01;
}

function surfaceFromRoot(root: ParentNode | null, hostname: string): ResolvedAutofillSurface | null {
  if (!root) return null;
  const detection = detectApplicationForm(root, hostname);
  if (!detection.isApplicationForm) return null;
  return { root, detection };
}

function accessibleIframeBodies(doc: Document): ParentNode[] {
  const bodies: ParentNode[] = [];
  for (const iframe of Array.from(doc.querySelectorAll("iframe"))) {
    try {
      const body = iframe.contentDocument?.body;
      if (body) bodies.push(body);
    } catch {
      // Cross-origin embed — cannot inspect from the parent frame.
    }
  }
  return bodies;
}

/**
 * Pick the document subtree (top page or same-origin iframe) that looks most
 * like an application form. Workday often paints an empty shell in the top
 * frame while inputs live in a child frame or load a moment later.
 */
export function resolveAutofillSurface(doc: Document, hostname: string): ResolvedAutofillSurface | null {
  const roots: ParentNode[] = [];
  if (doc.body) roots.push(doc.body);
  roots.push(...accessibleIframeBodies(doc));

  let best: ResolvedAutofillSurface | null = null;
  let bestScore = -1;
  for (const root of roots) {
    const surface = surfaceFromRoot(root, hostname);
    if (!surface) continue;
    const score = surfaceScore(surface.detection);
    if (score > bestScore) {
      bestScore = score;
      best = surface;
    }
  }
  return best;
}

export async function resolveAutofillSurfaceWithRetry(
  doc: Document,
  hostname: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<ResolvedAutofillSurface | null> {
  const attempts = options?.attempts ?? 1;
  const delayMs = options?.delayMs ?? 400;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const surface = resolveAutofillSurface(doc, hostname);
    if (surface) return surface;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}
