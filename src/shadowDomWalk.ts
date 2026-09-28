const DEFAULT_MAX_VISITS = 6_000;

/** Traverse light DOM + open shadow roots (MyGreenhouse embed widgets). */
export function forEachElementIncludingShadow(
  root: Document | Element | ShadowRoot,
  visit: (el: Element) => void,
  maxVisits = DEFAULT_MAX_VISITS,
): void {
  const counter = { count: 0 };
  const wrapped = (el: Element): void => {
    if (counter.count >= maxVisits) return;
    counter.count += 1;
    visit(el);
  };

  if (root instanceof Document) {
    if (root.body) walkElement(root.body, wrapped, counter, maxVisits);
    return;
  }

  if (root instanceof Element) {
    walkElement(root, wrapped, counter, maxVisits);
    return;
  }

  for (const child of Array.from(root.children)) {
    walkElement(child, wrapped, counter, maxVisits);
  }
}

function walkElement(
  el: Element,
  visit: (node: Element) => void,
  counter: { count: number },
  maxVisits: number,
): void {
  if (counter.count >= maxVisits) return;
  visit(el);
  if (el.shadowRoot) {
    forEachElementIncludingShadow(el.shadowRoot, visit, maxVisits - counter.count);
  }
  for (const child of Array.from(el.children)) {
    if (counter.count >= maxVisits) return;
    walkElement(child, visit, counter, maxVisits);
  }
}

/** Collect href/src/data-page snippets without scanning every innerHTML blob. */
export function collectShadowDomTextSnippets(doc: Document, maxSnippets = 120): string[] {
  const snippets: string[] = [];
  forEachElementIncludingShadow(doc, (el) => {
    if (snippets.length >= maxSnippets) return;
    if (el instanceof HTMLAnchorElement && el.href) snippets.push(el.href);
    if (el instanceof HTMLIFrameElement && el.src) snippets.push(el.src);
    const dataPage = el.getAttribute("data-page");
    if (dataPage) snippets.push(dataPage);
  });
  const rootHtml = doc.documentElement?.innerHTML?.slice(0, 250_000) ?? "";
  if (rootHtml) snippets.push(rootHtml);
  return snippets;
}
