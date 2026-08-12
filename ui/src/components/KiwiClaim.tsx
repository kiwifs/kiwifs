/**
 * KiwiClaim — Claim-level provenance from :::claim / :claim[...] directives.
 *
 * Markdown syntax:
 * ```
 * :::claim{evidence=inferred confidence=0.6}
 * A non-linear level-2 stacker wins when the dominant feature is sparse.
 * :::
 *
 * Inline: :claim[hill-climbing is worse]{evidence=stated confidence=0.9 source="sources/x"}
 * ```
 *
 * The point of the component is that an unsupported low-confidence assertion
 * should *look* different from a sourced one, so a reader spots it without
 * running the audit query. Confidence and evidence are shown, and a claim with
 * neither a source nor a confidence is marked as unsupported rather than
 * being rendered as ordinary prose.
 */

import React from "react";

import { claimEvidenceTone, formatConfidence, isUnsupportedClaim } from "../lib/claimDisplay";

interface KiwiClaimProps {
  children: React.ReactNode;
  evidence?: string;
  confidence?: string;
  source?: string;
  inline?: boolean;
}

export function KiwiClaim({ children, evidence, confidence, source, inline }: KiwiClaimProps) {
  const tone = claimEvidenceTone(evidence);
  const confidenceLabel = formatConfidence(confidence);
  const unsupported = isUnsupportedClaim({ confidence, source });

  const badges = (
    <span className="kiwi-claim-badges inline-flex items-center gap-1 align-middle">
      {evidence && (
        <span
          className={`kiwi-claim-badge rounded px-1.5 py-0.5 text-[0.7rem] font-medium ${tone}`}
          title={`Evidence: ${evidence}`}
        >
          {evidence}
        </span>
      )}
      {confidenceLabel && (
        <span
          className="kiwi-claim-confidence rounded px-1.5 py-0.5 text-[0.7rem] tabular-nums bg-muted text-muted-foreground"
          title={`Confidence: ${confidenceLabel}`}
        >
          {confidenceLabel}
        </span>
      )}
      {source ? (
        <span className="kiwi-claim-source text-[0.7rem] text-muted-foreground" title={`Source: ${source}`}>
          {source}
        </span>
      ) : (
        unsupported && (
          <span
            className="kiwi-claim-unsourced text-[0.7rem] text-muted-foreground italic"
            title="No supporting source recorded"
          >
            unsourced
          </span>
        )
      )}
    </span>
  );

  if (inline) {
    return (
      <span
        className={`kiwi-claim kiwi-claim-inline border-b border-dotted ${unsupported ? "border-amber-500" : "border-muted-foreground/50"}`}
        data-evidence={evidence}
        data-confidence={confidence}
      >
        {children} {badges}
      </span>
    );
  }

  return (
    <div
      className={`kiwi-claim kiwi-claim-block my-3 rounded-md border-l-4 pl-3 pr-2 py-2 ${
        unsupported ? "border-l-amber-500 bg-amber-500/5" : "border-l-muted-foreground/40 bg-muted/30"
      }`}
      data-evidence={evidence}
      data-confidence={confidence}
    >
      <div className="kiwi-claim-body">{children}</div>
      <div className="kiwi-claim-meta mt-1">{badges}</div>
    </div>
  );
}

export default KiwiClaim;
