/**
 * claimDisplay — pure presentation logic for claim-level provenance.
 *
 * The UI has no React render harness (all tests are pure-function), so the
 * decisions worth testing live here rather than inside `KiwiClaim.tsx`.
 */

/**
 * Confidence below which a claim reads as weak.
 *
 * This mirrors the threshold in K7's motivating query
 * (`FROM CLAIMS "inferred" WHERE confidence < 0.7 AND source IS NULL`) so a
 * claim the audit surfaces also *looks* flagged on the page. Change both or
 * the page quietly disagrees with the query.
 */
export const CLAIM_LOW_CONFIDENCE = 0.7;

export type ClaimAttrs = {
  evidence?: string;
  confidence?: string;
  source?: string;
};

/**
 * Parse a confidence attribute. Returns null for absent or non-numeric input
 * rather than NaN or a string — the server indexes an unparseable confidence
 * as null, and the badge must not claim a value the query cannot see.
 */
export function parseConfidence(raw: string | undefined | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Format a confidence for display. Values in 0..1 render as a percentage,
 * which is how confidences are conventionally written; anything outside that
 * range renders as the raw number rather than being rescaled into a
 * percentage it never meant.
 */
export function formatConfidence(raw: string | undefined | null): string | null {
  const n = parseConfidence(raw);
  if (n == null) return null;
  if (n >= 0 && n <= 1) return `${Math.round(n * 100)}%`;
  return String(n);
}

/** A claim with no `source` attribute has nothing backing it. */
export function isUnsourcedClaim(attrs: ClaimAttrs): boolean {
  return !attrs.source || attrs.source.trim() === "";
}

/** A claim whose confidence parses and falls below the threshold. */
export function isLowConfidence(raw: string | undefined | null): boolean {
  const n = parseConfidence(raw);
  return n != null && n < CLAIM_LOW_CONFIDENCE;
}

/**
 * Whether to flag the claim visually: nothing supports it, and it is either
 * explicitly low-confidence or carries no confidence at all.
 *
 * A sourced claim is never flagged however low its confidence — a low number
 * with a citation is honest bookkeeping, not a gap.
 */
export function isUnsupportedClaim(attrs: ClaimAttrs): boolean {
  if (!isUnsourcedClaim(attrs)) return false;
  return parseConfidence(attrs.confidence) == null || isLowConfidence(attrs.confidence);
}

const EVIDENCE_TONES: Record<string, string> = {
  stated: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  derived: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  inferred: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  assumed: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
};

/**
 * Badge classes for an evidence class. An unrecognised value still renders —
 * workspaces define their own vocabularies, and dropping the badge would hide
 * that the author said something.
 */
export function claimEvidenceTone(evidence: string | undefined | null): string {
  if (!evidence) return "bg-muted text-muted-foreground";
  return EVIDENCE_TONES[evidence.trim().toLowerCase()] || "bg-muted text-muted-foreground";
}
