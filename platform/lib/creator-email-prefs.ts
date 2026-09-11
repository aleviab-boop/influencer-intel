// ============================================================
// Creator email notification preferences.
//
// Creators can opt out of any category of transactional email we send them
// (invite / payment / review / deadline). Stored in the existing per-creator
// `creator_prefs` JSONB bag under the `email` key, so it coexists with other
// prefs (e.g. monthly_goal) without a new column:
//   creator_prefs = { monthly_goal: 50000, email: { invite: true, payment: false, ... } }
//
// Model is OPT-OUT: a missing flag means "yes, contact me". So a creator who
// never touched settings still counts as reachable, and only an explicit
// `false` suppresses a category. Email delivery itself is manual (handoff) on
// this platform; these flags record the creator's stated contact preferences.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';

export type EmailPrefKey = 'invite' | 'payment' | 'review' | 'deadline';
export const EMAIL_PREF_KEYS: EmailPrefKey[] = ['invite', 'payment', 'review', 'deadline'];

export type EmailPrefs = Record<EmailPrefKey, boolean>;

// The email_log `kind` values collapse onto four user-facing categories — both
// review verdicts share one toggle (a creator who mutes reviews mutes both).
export function kindToPrefKey(kind: string): EmailPrefKey | null {
  switch (kind) {
    case 'invite':
    case 'application_accepted':
    case 'application_declined': return 'invite';
    case 'payment': return 'payment';
    case 'review_changes':
    case 'review_approved': return 'review';
    case 'deadline': return 'deadline';
    default: return null;
  }
}

/** All-on defaults — the opt-out baseline every creator starts from. */
export function defaultEmailPrefs(): EmailPrefs {
  return { invite: true, payment: true, review: true, deadline: true };
}

// Normalise whatever is stored (or nothing) into a full, typed EmailPrefs.
// Only an explicit `false` turns a category off; anything else stays on.
export function readEmailPrefs(rawCreatorPrefs: unknown): EmailPrefs {
  const out = defaultEmailPrefs();
  const bag = rawCreatorPrefs as { email?: Record<string, unknown> } | null | undefined;
  const email = bag?.email;
  if (email && typeof email === 'object') {
    for (const k of EMAIL_PREF_KEYS) {
      if (email[k] === false) out[k] = false;
    }
  }
  return out;
}

// Merge a partial toggle patch into the existing creator_prefs bag, preserving
// every non-email key. Returns the full JSONB object to persist.
export function mergeEmailPrefs(
  rawCreatorPrefs: unknown,
  patch: Partial<EmailPrefs>,
): Record<string, unknown> {
  const bag = (rawCreatorPrefs && typeof rawCreatorPrefs === 'object'
    ? { ...(rawCreatorPrefs as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  const current = readEmailPrefs(rawCreatorPrefs);
  const next: EmailPrefs = { ...current };
  for (const k of EMAIL_PREF_KEYS) {
    if (typeof patch[k] === 'boolean') next[k] = patch[k]!;
  }
  bag.email = next;
  return bag;
}

/** Load a creator's normalised email prefs. Defaults to all-on on any miss. */
export async function loadEmailPrefs(creatorId: string): Promise<EmailPrefs> {
  try {
    const rows = await getBolticClient().query<{ creator_prefs: unknown }>(
      `SELECT creator_prefs FROM creators WHERE id = $1 LIMIT 1`,
      [creatorId],
    );
    return readEmailPrefs(rows[0]?.creator_prefs);
  } catch {
    return defaultEmailPrefs(); // never let a read error suppress mail
  }
}

// The send-time gate. Returns true (send) unless the creator has explicitly
// opted out of this email's category. Unknown/unmapped kinds always send.
export async function creatorWantsEmail(
  creatorId: string | null | undefined,
  kind: string,
): Promise<boolean> {
  if (!creatorId) return true;
  const key = kindToPrefKey(kind);
  if (!key) return true;
  const prefs = await loadEmailPrefs(creatorId);
  return prefs[key];
}

/** Persist a toggle patch, preserving other creator_prefs. Returns saved prefs. */
export async function saveEmailPrefs(
  creatorId: string,
  patch: Partial<EmailPrefs>,
): Promise<EmailPrefs> {
  const db = getBolticClient();
  const rows = await db.query<{ creator_prefs: unknown }>(
    `SELECT creator_prefs FROM creators WHERE id = $1 LIMIT 1`,
    [creatorId],
  );
  const merged = mergeEmailPrefs(rows[0]?.creator_prefs, patch);
  await db.update('creators', { id: creatorId }, {
    creator_prefs: JSON.stringify(merged),
    updated_at: new Date().toISOString(),
  });
  return readEmailPrefs(merged);
}
