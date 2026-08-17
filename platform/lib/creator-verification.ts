// ============================================================
// Creator verification — a trust ladder that lets creators self-onboard WITHOUT
// the Meta App Review gate. App Review is only needed to pull data via the
// Instagram Graph API (OAuth) for the public; everything below that rung is
// reachable with zero Meta involvement:
//
//   oauth         — connected their IG (live Graph API metrics)          [top]
//   screenshot    — uploaded an Insights screenshot as proof
//   public        — auto-filled from their PUBLIC profile (login-free fetch)
//   self_reported — typed their own numbers in; unverified
//   none          — nothing on file yet                                  [base]
//
// Pure and deterministic: given a few booleans the route already gathered, it
// picks the highest rung reached and returns its display copy. No DB, no writes,
// no Meta. Mirrors the pure-builder pattern used across the deal/notification
// libs. The stored `verification_tier` column is the persisted counterpart; this
// derives the *effective* tier live so a lapsed OAuth connection degrades
// gracefully to whatever softer proof still holds.
// ============================================================

export type VerificationTier = 'oauth' | 'screenshot' | 'public' | 'self_reported' | 'none';

export interface VerificationInput {
  has_oauth: boolean;        // an active, unexpired connected_accounts row
  has_screenshot: boolean;   // an Insights screenshot on file
  has_public_data: boolean;  // public profile auto-fill landed (followers on record)
  has_self_reported: boolean; // typed reach / rate with nothing stronger behind it
}

export interface Verification {
  tier: VerificationTier;
  label: string;           // short badge text
  description: string;     // one line explaining what this proves
  verified: boolean;       // true for any rung above self_reported
  strength: number;        // 0-100, for a progress affordance
  can_upgrade: boolean;    // is there a higher rung to reach?
  next_hint: string | null; // how to climb one rung, or null at the top
}

const RUNG: Record<VerificationTier, number> = {
  none: 0, self_reported: 1, public: 2, screenshot: 3, oauth: 4,
};

const COPY: Record<VerificationTier, { label: string; description: string; strength: number }> = {
  oauth: { label: 'Instagram verified', description: 'Live metrics pulled straight from your connected Instagram account.', strength: 100 },
  screenshot: { label: 'Insights verified', description: 'Reach and audience confirmed from an uploaded Instagram Insights screenshot.', strength: 80 },
  public: { label: 'Public profile checked', description: 'Follower count and engagement pulled from your public Instagram profile.', strength: 60 },
  self_reported: { label: 'Self-reported', description: 'Numbers you entered yourself — add proof to stand out to brands.', strength: 25 },
  none: { label: 'Unverified', description: 'No reach data on file yet.', strength: 0 },
};

const NEXT_HINT: Record<VerificationTier, string | null> = {
  none: 'Fetch your public stats to get started — no Instagram login needed.',
  self_reported: 'Fetch your public stats to confirm your follower count automatically.',
  public: 'Upload an Instagram Insights screenshot to verify your engagement and audience.',
  screenshot: 'Connect Instagram for always-live metrics (optional).',
  oauth: null,
};

/** Pick the highest rung the creator has actually reached. */
export function computeVerification(input: VerificationInput): Verification {
  const tier: VerificationTier =
    input.has_oauth ? 'oauth'
    : input.has_screenshot ? 'screenshot'
    : input.has_public_data ? 'public'
    : input.has_self_reported ? 'self_reported'
    : 'none';

  const copy = COPY[tier];
  return {
    tier,
    label: copy.label,
    description: copy.description,
    verified: RUNG[tier] >= RUNG.public, // public and above count as "verified"
    strength: copy.strength,
    can_upgrade: RUNG[tier] < RUNG.oauth,
    next_hint: NEXT_HINT[tier],
  };
}
