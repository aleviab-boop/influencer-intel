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
import { notifySlack } from '../notify-slack.js';

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 90 * 60 * 1000; // rest a 429'd account for 90 min
// A single 401/403 from IG is very often a TRANSIENT soft-block/challenge under
// load, NOT a genuinely dead login — and the old code parked (force-expired) the
// account on the first one, which is why accounts "died early" and needed a
// manual re-capture far short of their 30-day cookie life. We now require this
// many CONSECUTIVE dead-signals before concluding the session is truly gone;
// any successful request in between resets the streak. Below the threshold a
// dead-signal is treated like a throttle (short cooldown + rotate) so the
// account gets a chance to recover on its own.
const DEAD_STRIKES_TO_PARK = 3;

interface AcctState {
  account: ServiceAccount;
  actionsThisHour: number;
  hourResetAt: number;
  cooldownUntil: number; // epoch ms; 0 = not cooling
  totalActions: number;
  deadStrikes: number; // consecutive 401/403 signals; reset on any success
}

// The active, session-bearing accounts eligible for rotation. Shared by the
// initial load and the periodic in-place refresh so they never diverge.
const POOL_QUERY = `SELECT * FROM service_accounts
   WHERE platform = 'instagram' AND status = 'active' AND storage_state IS NOT NULL
     AND (storage_expires_at IS NULL OR storage_expires_at > now())
   ORDER BY storage_captured_at DESC NULLS LAST`;

function cooldownMs(a: ServiceAccount): number {
  const cd = (a as { cooldown_until?: string | null }).cooldown_until;
  const t = cd ? new Date(cd).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

export class AccountPool {
  private states: AcctState[] = [];
  private idx = 0;

  static async load(): Promise<AccountPool> {
    const rows = await getBolticClient().query<ServiceAccount>(POOL_QUERY);
    const pool = new AccountPool();
    const now = Date.now();
    pool.states = rows.map((a) => ({
      // Cooldowns are persisted (service_accounts.cooldown_until) so a 429'd
      // account stays rested across worker restarts / hot-reloads — otherwise
      // every reload wiped the in-memory cooldown and snapped back to the same
      // (still-throttled) account.
      account: a,
      actionsThisHour: 0,
      hourResetAt: now + HOUR_MS,
      cooldownUntil: cooldownMs(a),
      totalActions: 0,
      deadStrikes: 0,
    }));
    // Start on the first account that isn't currently cooling down.
    const firstReady = pool.states.findIndex((s) => now >= s.cooldownUntil);
    pool.idx = firstReady >= 0 ? firstReady : 0;
    return pool;
  }

  /**
   * Re-read the pool from the DB in place, so accounts captured/revived while
   * the worker runs join rotation — and removed/expired ones drop — WITHOUT a
   * restart. Existing accounts keep their in-memory usage counters; the DB's
   * cooldown_until is taken as source of truth (a re-capture clears it, which
   * is exactly how a revived account snaps back to ready here). Returns the
   * handles added/removed so the caller can log the change.
   */
  async refresh(): Promise<{ added: string[]; removed: string[] }> {
    const rows = await getBolticClient().query<ServiceAccount>(POOL_QUERY);
    const now = Date.now();
    const prevById = new Map(this.states.map((s) => [s.account.id, s]));
    const keepId = this.states[this.idx]?.account.id;

    const added: string[] = [];
    this.states = rows.map((a) => {
      const ex = prevById.get(a.id);
      if (ex) {
        ex.account = a;
        ex.cooldownUntil = cooldownMs(a); // DB authoritative — picks up revives
        return ex;
      }
      added.push(a.handle);
      return {
        account: a,
        actionsThisHour: 0,
        hourResetAt: now + HOUR_MS,
        cooldownUntil: cooldownMs(a),
        totalActions: 0,
        deadStrikes: 0,
      };
    });

    const liveIds = new Set(rows.map((a) => a.id));
    const removed = [...prevById.values()]
      .filter((s) => !liveIds.has(s.account.id))
      .map((s) => s.account.handle);

    // Keep pointing at the same account if it survived; otherwise fall back to
    // the first ready one. (The orchestrator reconciles the browser after.)
    const idx = keepId ? this.states.findIndex((s) => s.account.id === keepId) : -1;
    this.idx = idx >= 0 ? idx : Math.max(0, this.states.findIndex((s) => now >= s.cooldownUntil));
    return { added, removed };
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

  /** The active account answered a request successfully → clear its dead-strike
   * streak, so a later isolated 401/403 starts counting from zero again and a
   * healthy account is never parked by scattered, non-consecutive blips. */
  reportAlive(): void {
    const s = this.states[this.idx]!;
    if (s.deadStrikes) {
      console.log(`[pool] @${s.account.handle} responded OK → clearing ${s.deadStrikes} dead-strike(s)`);
      s.deadStrikes = 0;
    }
  }

  /** A dead-signal (401/403) on the active account. A SINGLE one is usually a
   * transient IG block/challenge, not a genuinely dead login — so we only PARK
   * (force-expire, needs manual re-capture) after DEAD_STRIKES_TO_PARK
   * CONSECUTIVE signals. Below that we just cool the account down like a 429 and
   * rotate, giving it a chance to recover on its own. Returns true iff it was
   * actually parked. This is the fix for accounts "dying early". */
  markCurrentDead(): boolean {
    const s = this.states[this.idx]!;
    s.deadStrikes += 1;
    if (s.deadStrikes < DEAD_STRIKES_TO_PARK) {
      s.cooldownUntil = Date.now() + DEFAULT_COOLDOWN_MS; // rest & retry, don't park
      console.warn(`[pool] @${s.account.handle} dead-signal ${s.deadStrikes}/${DEAD_STRIKES_TO_PARK} (401/403) → cooling down ${Math.round(DEFAULT_COOLDOWN_MS / 60000)}min, NOT parked yet`);
      void this.persist(s);
      return false;
    }
    s.cooldownUntil = Date.now() + 30 * 24 * HOUR_MS; // effectively parked
    console.warn(`[pool] @${s.account.handle} session DEAD (confirmed after ${s.deadStrikes} consecutive 401/403) → parking it. Re-capture with: SERVICE_ACCOUNT_HANDLE=${s.account.handle} npm run scraper:capture`);
    // Ping the operator so a dead account is re-captured promptly (no-op if no webhook).
    void notifySlack(
      `:warning: IG scraper account *@${s.account.handle}* session died (confirmed after ${s.deadStrikes} consecutive 401/403) — parked out of rotation.\n` +
      `Re-capture it: \`SERVICE_ACCOUNT_HANDLE=${s.account.handle} npm run scraper:capture\``,
    );
    void (async () => {
      try {
        await getBolticClient().update(
          'service_accounts',
          { id: s.account.id },
          {
            cooldown_until: new Date(s.cooldownUntil).toISOString(),
            storage_expires_at: new Date().toISOString(), // expire so load() drops it until re-captured
            updated_at: new Date().toISOString(),
          },
        );
      } catch {
        /* best-effort */
      }
    })();
    return true;
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
    let bestTotal = Infinity;
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i]!;
      this.maybeReset(s);
      if (now < s.cooldownUntil) continue;
      if (s.actionsThisHour >= config.maxActionsPerHour) continue;
      // Least-loaded first: fewest actions this hour, then fewest lifetime
      // actions. The lifetime tie-break matters because actionsThisHour resets
      // every hour — without it, the picker would keep favouring the same
      // (earliest-listed) accounts after each reset and slowly overwork them.
      // With it, load equalises evenly across the whole pool over time, so no
      // single account accrues enough to get flagged/killed.
      if (s.actionsThisHour < bestActions || (s.actionsThisHour === bestActions && s.totalActions < bestTotal)) {
        bestActions = s.actionsThisHour;
        bestTotal = s.totalActions;
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

  /** Stamp the active account as "used just now" so the admin panel can show a
   * live "active now" badge on whichever account is currently crawling.
   * Best-effort + fire-and-forget — never blocks or fails the job loop. */
  markActive(): void {
    const s = this.states[this.idx]!;
    void (async () => {
      try {
        await getBolticClient().update(
          'service_accounts',
          { id: s.account.id },
          { last_used_at: new Date().toISOString() },
        );
      } catch {
        /* best-effort */
      }
    })();
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
