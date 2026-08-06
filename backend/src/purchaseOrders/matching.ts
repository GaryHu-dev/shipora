export const FUZZY_MATCH_THRESHOLD = 0.4;

export interface MatchCandidate {
  id: string;
  sku: string | null;
  title: string;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length > 0)
  );
}

// Jaccard-style token overlap: shared tokens over the larger token set, so a
// candidate title that's a strict superset/subset of the description still
// scores below 1 (penalises size mismatch, not just missing overlap).
export function scoreTitleMatch(description: string, candidateTitle: string): number {
  const a = tokenize(description);
  const b = tokenize(candidateTitle);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  return overlap / Math.max(a.size, b.size);
}

export function pickBestMatch(
  description: string,
  candidates: MatchCandidate[]
): (MatchCandidate & { score: number }) | null {
  let best: (MatchCandidate & { score: number }) | null = null;
  for (const c of candidates) {
    const score = scoreTitleMatch(description, c.title);
    if (score >= FUZZY_MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { ...c, score };
    }
  }
  return best;
}
