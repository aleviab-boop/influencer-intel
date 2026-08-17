// ============================================================
// Instagram Connect — beta access gate
//
// Instagram Login (OAuth) only works for accounts we've added as *testers* in
// the Meta App Dashboard until the app clears App Review and goes Live. So a
// real creator who isn't on that tester list would otherwise be bounced to
// Instagram only to hit a confusing "invalid platform app" wall. This gate lets
// us fail *gracefully* on our side instead: allowlisted handles connect, and
// everyone else is offered the waitlist.
//
// Source of truth for who can connect is env — the SAME handles you added as
// testers in the dashboard:
//   IG_BETA_HANDLES = "creator.one, creator.two, ..."   (comma/space separated)
//   IG_BETA_OPEN    = "true"   → gate off, anyone can connect (set once Live)
//
// Pure + env-only except for the two tiny waitlist DB helpers at the bottom.
// ============================================================

import type { getBolticClient } from '@influencer-intel/shared/db';

/** Normalise a handle for comparison: strip @, lowercase, drop trailing slash. */
export function canonHandle(h: string): string {
  return h.trim().replace(/^@/, '').replace(/\/+$/, '').toLowerCase();
}

/** True once the app is approved + Live — the gate is lifted for everyone. */
export function isBetaOpen(): boolean {
  return process.env.IG_BETA_OPEN === 'true';
}

/** The allowlisted tester handles from env, normalised. */
export function allowedHandles(): Set<string> {
  const raw = process.env.IG_BETA_HANDLES ?? '';
  const set = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const h = canonHandle(part);
    if (h) set.add(h);
  }
  return set;
}

/**
 * Can this handle connect right now? True when the gate is open (Live) OR the
 * handle is on the tester allowlist. An empty/unknown handle is only allowed
 * when the gate is open (we can't verify it against the allowlist).
 */
export function isHandleAllowed(handle: string | null | undefined): boolean {
  if (isBetaOpen()) return true;
  const h = handle ? canonHandle(handle) : '';
  if (!h) return false;
  return allowedHandles().has(h);
}

export interface BetaStatus {
  open: boolean;          // gate lifted for everyone?
  gated: boolean;         // inverse of open — a beta gate is in force
  allowlist_size: number; // how many testers are configured
}

export function betaStatus(): BetaStatus {
  const open = isBetaOpen();
  return { open, gated: !open, allowlist_size: allowedHandles().size };
}

// ── waitlist DB helpers ──────────────────────────────────────────────────────

type DB = ReturnType<typeof getBolticClient>;

/** Is this handle already on the pending waitlist? */
export async function isOnWaitlist(db: DB, handle: string): Promise<boolean> {
  const h = canonHandle(handle);
  if (!h) return false;
  const rows = await db.query<{ handle: string }>(
    `SELECT handle FROM oauth_beta_waitlist WHERE handle = $1 LIMIT 1`,
    [h],
  );
  return rows.length > 0;
}

/**
 * Add (or refresh) a handle on the beta waitlist. Idempotent on handle — a
 * repeat request just updates the optional email/note without duplicating.
 */
export async function joinWaitlist(db: DB, handle: string, email?: string | null, note?: string | null): Promise<boolean> {
  const h = canonHandle(handle);
  if (!h) return false;
  const cleanEmail = (email ?? '').trim() || null;
  const cleanNote = (note ?? '').trim().slice(0, 500) || null;
  await db.query(
    `INSERT INTO oauth_beta_waitlist (handle, email, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (handle) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, oauth_beta_waitlist.email),
       note  = COALESCE(EXCLUDED.note,  oauth_beta_waitlist.note)`,
    [h, cleanEmail, cleanNote],
  );
  return true;
}
