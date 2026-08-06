// ============================================================
// Deal evaluator — "is this offer fair?".
//
// A brand slides a number across the table; this tells the creator where it
// sits against their own earned media value and rate-card range, and what to
// counter with. Pure and deterministic — the same offer always yields the same
// verdict, so the creator can trust it in a live negotiation.
//
// Anchor logic:
//   • fair value  = per-post EMV midpoint (what a post is worth in ad-spend
//                   terms). If EMV is missing we fall back to the rate-card
//                   midpoint.
//   • the verdict compares the offer to that anchor as a ratio, with a couple
//     of coarse bands a creator can act on.
//   • the counter is nudged toward the top of their defensible range.
//
// No LLM, no network — just arithmetic over numbers already on the dashboard.
// ============================================================

export type DealVerdictKey = 'lowball' | 'below' | 'fair' | 'strong' | 'premium';

export interface DealInputs {
  per_post_low: number | null;
  per_post_mid: number | null;    // EMV midpoint — the primary anchor
  per_post_high: number | null;
  ask_low: number | null;         // rate-card / suggested-ask range (optional)
  ask_high: number | null;
}

export interface DealVerdict {
  available: boolean;
  offer: number;
  anchor: number | null;          // the fair-value figure we compared against
  ratio: number | null;           // offer ÷ anchor
  verdict: DealVerdictKey;
  label: string;                  // short human label
  message: string;                // one-line guidance
  counter: number | null;         // suggested counter-offer (null if none needed)
  fair_low: number | null;        // the range we consider fair to accept
  fair_high: number | null;
}

const round100 = (v: number): number => Math.round(v / 100) * 100;

const LABELS: Record<DealVerdictKey, string> = {
  lowball: 'Lowball',
  below: 'Below your worth',
  fair: 'Fair',
  strong: 'Strong offer',
  premium: 'Premium',
};

/**
 * Evaluate a brand's proposed per-post offer. `offer` in ₹. Returns a shell
 * with available:false when there's nothing sensible to anchor against.
 */
export function evaluateDeal(offer: number, inputs: DealInputs): DealVerdict {
  const empty: DealVerdict = {
    available: false, offer, anchor: null, ratio: null,
    verdict: 'fair', label: LABELS.fair, message: '', counter: null,
    fair_low: null, fair_high: null,
  };
  if (!Number.isFinite(offer) || offer <= 0) return empty;

  // Anchor = EMV midpoint, else rate-card midpoint.
  const emvMid = num(inputs.per_post_mid);
  const askMid = inputs.ask_low != null && inputs.ask_high != null
    ? (num(inputs.ask_low)! + num(inputs.ask_high)!) / 2
    : null;
  const anchor = emvMid ?? askMid;
  if (anchor == null || anchor <= 0) return empty;

  // The "fair to accept" band: blend EMV and ask ranges when both exist.
  const fairLow = firstFinite([inputs.per_post_low, inputs.ask_low, anchor * 0.85]);
  const fairHigh = firstFinite([inputs.per_post_high, inputs.ask_high, anchor * 1.35]);

  const ratio = offer / anchor;
  const verdict: DealVerdictKey =
    ratio < 0.6 ? 'lowball'
      : ratio < 0.85 ? 'below'
        : ratio <= 1.2 ? 'fair'
          : ratio <= 1.6 ? 'strong'
            : 'premium';

  // Counter-offer: only when the offer is under fair. Aim for the top of the
  // defensible range (fairHigh), but never below a modest bump on the offer.
  let counter: number | null = null;
  if (verdict === 'lowball' || verdict === 'below') {
    const target = fairHigh ?? anchor * 1.2;
    counter = round100(Math.max(target, offer * 1.25));
  }

  const message = messageFor(verdict, {
    anchor, counter, fairLow, fairHigh, offer,
  });

  return {
    available: true,
    offer,
    anchor: Math.round(anchor),
    ratio: Math.round(ratio * 100) / 100,
    verdict,
    label: LABELS[verdict],
    message,
    counter,
    fair_low: fairLow != null ? round100(fairLow) : null,
    fair_high: fairHigh != null ? round100(fairHigh) : null,
  };
}

function messageFor(
  v: DealVerdictKey,
  ctx: { anchor: number; counter: number | null; fairLow: number | null; fairHigh: number | null; offer: number },
): string {
  const inr = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');
  switch (v) {
    case 'lowball':
      return `This is well under what your reach is worth (${inr(ctx.anchor)}/post). Politely counter${ctx.counter ? ` around ${inr(ctx.counter)}` : ''} and lead with your engagement numbers.`;
    case 'below':
      return `A little light. Your work sits closer to ${inr(ctx.anchor)}/post — counter${ctx.counter ? ` toward ${inr(ctx.counter)}` : ''} or ask them to add a deliverable.`;
    case 'fair':
      return `Right in your fair range${ctx.fairLow && ctx.fairHigh ? ` (${inr(ctx.fairLow)}–${inr(ctx.fairHigh)})` : ''}. Reasonable to accept — or nudge up if usage rights / exclusivity are involved.`;
    case 'strong':
      return `Above your baseline worth — a good deal. Say yes, and clarify deliverables and timelines in writing.`;
    case 'premium':
      return `Well above your estimated value. Great offer — lock it in, and make sure the scope (whitelisting, exclusivity) matches the price.`;
  }
}

// ---- tiny helpers ----------------------------------------------------------
function num(v: number | null | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function firstFinite(candidates: (number | null | undefined)[]): number | null {
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
