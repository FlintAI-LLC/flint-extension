import { finalizeJdText, isMyGreenhouseAggregatorNoise } from "./jdParse.js";

const MIN_JD_LENGTH = 200;

export function isMyGreenhouseHost(hostname: string): boolean {
  return hostname.toLowerCase() === "my.greenhouse.io";
}

function parseMyGreenhouseHeader(lines: string[]): { title: string; company: string } {
  if (lines.length < 2) return { title: "", company: "" };

  let locationIdx = lines.length - 1;
  while (locationIdx >= 0 && !/^(Remote|Hybrid|On[- ]site)$/i.test(lines[locationIdx])) {
    locationIdx -= 1;
  }
  if (locationIdx < 1) return { title: "", company: "" };

  return {
    company: lines[locationIdx - 1] ?? "",
    title: lines[locationIdx - 2] ?? lines[0] ?? "",
  };
}

export function parseMyGreenhouseJobText(
  raw: string,
): { title: string; company: string; text: string } | null {
  const postedIdx = raw.search(/Posted\s*[·•]\s*\d+/i);
  if (postedIdx < 0) return null;

  let text = raw;
  const endMarkers = [
    /Profile checklist/i,
    /Drop your resume or browse to autofill/i,
    /Your job alerts/i,
    /This site uses cookies/i,
    /Recommended Roles/i,
    /Active applications/i,
    /Find the right role and make it your Dream Job/i,
    /Search smarter, apply faster/i,
  ];
  for (const marker of endMarkers) {
    const idx = text.search(marker);
    if (idx > 400) {
      text = text.slice(0, idx).trim();
      break;
    }
  }

  const headerLines = text
    .slice(0, postedIdx)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const { title, company } = parseMyGreenhouseHeader(headerLines);

  const body = text
    .slice(postedIdx)
    .replace(/^Posted\s*[·•]\s*[\w\s]+ago\s*/i, "")
    .trim();
  if (body.length < MIN_JD_LENGTH) return null;
  if (isMyGreenhouseAggregatorNoise(body)) return null;

  return {
    title,
    company,
    text: finalizeJdText(body),
  };
}

export function extractMyGreenhouseFromDocument(
  doc: Document,
): { title: string; company: string; text: string } | null {
  const candidates = Array.from(doc.querySelectorAll("main, article, section, div"));
  let best: { title: string; company: string; text: string } | null = null;
  let bestLen = Infinity;

  for (const el of candidates) {
    const raw = el.textContent ?? "";
    if (!/Posted\s*[·•]\s*\d+/i.test(raw)) continue;
    if (/HomeProfileApplications|Dream Job/i.test(raw.slice(0, 160))) continue;
    if (raw.length < MIN_JD_LENGTH || raw.length > 30_000) continue;
    const parsed = parseMyGreenhouseJobText(raw);
    if (!parsed || parsed.text.length < MIN_JD_LENGTH) continue;
    if (parsed.text.length < bestLen) {
      best = parsed;
      bestLen = parsed.text.length;
    }
  }

  if (best) return best;
  return parseMyGreenhouseJobText(doc.body?.textContent ?? "");
}
