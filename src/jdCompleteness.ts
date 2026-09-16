/** Hosts where auto-extracted JD text may be incomplete or aggregator-summarized. */

const UNCERTAIN_JD_HOST_PATTERNS = [
  "my.greenhouse.io",
  "jobright.ai",
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
  "builtin.com",
  "wellfound.com",
  "dice.com",
  "simplyhired.com",
  "careerbuilder.com",
  "hiring.cafe",
  "otta.com",
  "talent.com",
  "snagajob.com",
];

export function isUncertainJdSource(
  url: string | null | undefined,
  extractionMethod?: "structured" | "heuristic",
): boolean {
  if (extractionMethod === "heuristic") return true;
  if (!url?.trim()) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return UNCERTAIN_JD_HOST_PATTERNS.some((pattern) => host.includes(pattern));
  } catch {
    return true;
  }
}
