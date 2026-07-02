// ============================================================
// Account pool — rotates the worker across multiple Instagram service
// accounts so no single account crosses IG's rate limit. Each account gets
// up to `maxActionsPerHour` actions, then the worker swaps to the least-used
// available account. A 429 puts the offending account into cooldown so it's
// skipped until it recovers. Degrades gracefully: with one account it behaves
// exactly like the old single-account worker (just throttles on the cap).
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import type { ServiceAccount } from '@influencer-intel/shared/types';
import { config } from '../config.js';

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 90 * 60 * 1000; // rest a 429'd account for 90 min

interface AcctState {
  account: ServiceAccount;
  actionsThisHour: number;
  hourResetAt: number;
  cooldownUntil: number; // epoch ms; 0 = not cooling
  totalActions: number;
}

export class AccountPool {
  private states: AcctState[] = [];
  private idx = 0;

  static async load(): Promise<AccountPool> {
    const db = getBolticClient();
    const rows = await db.query<ServiceAccount>(
      `SELECT * FROM service_accounts
       WHERE platform = 'instagram' AND status = 'active' AND storage_state IS NOT NULL
         AND (storage_expires_at IS NULL OR storage_expires_at > now())
       ORDER BY storage_captured_at DESC NULLS LAST`,
    );
    const pool = new AccountPool();
    const now = Date.now();
    pool.states = rows.map((a) => {
      // Cooldowns are persisted (service_accounts.cooldown_until) so a 429'd
      // account stays rested across worker restarts / hot-reloads — otherwise
      // every reload wiped the in-memory cooldown and snapped back to the same
      // (still-throttled) account.
      const cd = (a as { cooldown_until?: string | null }).cooldown_until;
      const cooldownUntil = cd ? new Date(cd).getTime() : 0;
      return {
        account: a,
        actionsThisHour: 0,
        hourResetAt: now + HOUR_MS,
        cooldownUntil: Number.isFinite(cooldownUntil) ? cooldownUntil : 0,
        totalActions: 0,
      };
    });
    // Start on the first account that isn't currently cooling down.
    const firstReady = pool.states.findIndex((s) => now >= s.cooldownUntil);
    pool.idx = firstReady >= 0 ? firstReady : 0;
    return pool;
  }

  get size(): number {
    return this.states.length;
  }

  current(): ServiceAccount {
    return this.states[this.idx]!.account;
  }

  private maybeReset(s: AcctState): void {
    if (Date.now() > s.hourResetAt) {
      s.actionsThisHour = 0;
      s.hourResetAt = Date.now() + HOUR_MS;
    }
  }

  /** Record actions against the active account (called via the queue). */
  note(n = 1): void {
    const s = this.states[this.idx]!;
    this.maybeReset(s);
    s.actionsThisHour += n;
    s.totalActions += n;
  }

  /** The active account is over its hourly cap or cooling down → time to swap. */
  dueForRotation(): boolean {
    const s = this.states[this.idx]!;
    this.maybeReset(s);
    return s.actionsThisHour >= config.maxActionsPerHour || Date.now() < s.cooldownUntil;
  }

  /** Cool down the active account (after a 429) so it's skipped until it recovers. */
  penalizeCurrent(ms = DEFAULT_COOLDOWN_MS): void {
    const s = this.states[this.idx]!;
    s.cooldownUntil = Date.now() + ms;
    console.warn(`[pool] @${s.account.handle} rate-limited → cooling down ${Math.round(ms / 60000)}min`);
    void this.persist(s);
  }

  /**
   * Pick the best available account: not cooling down, under its hourly cap,
   * lowest current usage. Sets it active. Returns null when every account is
   * exhausted/cooling (caller should wait).
   */
  pickNext(): ServiceAccount | null {
    const now = Date.now();
    let best = -1;
    let bestActions = Infinity;
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i]!;
      this.maybeReset(s);
      if (now < s.cooldownUntil) continue;
      if (s.actionsThisHour >= config.maxActionsPerHour) continue;
      if (s.actionsThisHour < bestActions) {
        bestActions = s.actionsThisHour;
        best = i;
      }
    }
    if (best === -1) return null;
    this.idx = best;
    return this.states[best]!.account;
  }

  /** Ms until the soonest account frees up — for sleeping when all are tapped out. */
  nextAvailableInMs(): number {
    const now = Date.now();
    let soonest = Infinity;
    for (const s of this.states) {
      const cooldownWait = Math.max(0, s.cooldownUntil - now);
      const capWait = s.actionsThisHour >= config.maxActionsPerHour ? Math.max(0, s.hourResetAt - now) : 0;
      soonest = Math.min(soonest, Math.max(cooldownWait, capWait));
    }
    return Number.isFinite(soonest) ? soonest : HOUR_MS;
  }

  status(): string {
    return this.states
      .map((s, i) => `${i === this.idx ? '*' : ' '}@${s.account.handle}:${s.actionsThisHour}/${config.maxActionsPerHour}${Date.now() < s.cooldownUntil ? ' (cool)' : ''}`)
      .join('  ');
  }

  private async persist(s: AcctState): Promise<void> {
    try {
      await getBolticClient().update(
        'service_accounts',
        { id: s.account.id },
        {
          daily_action_count: s.totalActions,
          cooldown_until: s.cooldownUntil ? new Date(s.cooldownUntil).toISOString() : null,
          updated_at: new Date().toISOString(),
        },
      );
    } catch {
      /* best-effort */
    }
  }
}
