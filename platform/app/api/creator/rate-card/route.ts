import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildRateCard, sanitizeRateCard, type RateCardStored } from '@/lib/rate-card';

export const runtime = 'nodejs';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
function asPrefs(v: unknown): Record<string, unknown> {
  const obj = typeof v === 'string' ? safeParse(v) : v;
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
}

async function resolveCreatorId(
  db: ReturnType<typeof getBolticClient>,
  accountId: string | null,
  handle: string | null,
): Promise<string | null> {
  if (accountId) {
    const rows = await db.query<{ creator_id: string }>(
      `SELECT creator_id FROM connected_accounts WHERE id = $1 LIMIT 1`, [accountId],
    );
    return rows[0]?.creator_id ?? null;
  }
  if (handle) {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM creators WHERE LOWER(handle) = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1`, [handle],
    );
    return rows[0]?.id ?? null;
  }
  const rows = await db.query<{ creator_id: string }>(
    `SELECT creator_id FROM connected_accounts WHERE connection_status = 'active'
     ORDER BY connected_at DESC LIMIT 1`,
  );
  return rows[0]?.creator_id ?? null;
}

interface StatsRow {
  follower_count: string | number | null;
  engagement_rate: string | number | null;
  creator_prefs: unknown;
}

async function cardFor(db: ReturnType<typeof getBolticClient>, creatorId: string): Promise<ReturnType<typeof buildRateCard>> {
  const rows = await db.query<StatsRow>(
    `SELECT follower_count, engagement_rate, creator_prefs FROM creators WHERE id = $1 LIMIT 1`, [creatorId],
  );
  const row = rows[0];
  const prefs = asPrefs(row?.creator_prefs);
  const stored = (prefs.rate_card ?? null) as RateCardStored | null;
  return buildRateCard({
    follower_count: num(row?.follower_count),
    engagement_rate: num(row?.engagement_rate),
    stored,
  });
}

/** GET /api/creator/rate-card?handle=|account= — suggested + saved rate card. */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').toLowerCase() ?? null;
  const db = getBolticClient();

  try {
    const creatorId = await resolveCreatorId(db, accountId, handle);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });
    return NextResponse.json(await cardFor(db, creatorId));
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * PATCH /api/creator/rate-card?handle=|account=
 * Body: { rates?: {reel,feed_post,...}, enabled?: {...}, note?: string }
 * Merges the sanitized rate card into creator_prefs.rate_card, then returns the
 * freshly-derived card.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').toLowerCase() ?? null;
  const db = getBolticClient();

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch = sanitizeRateCard(body);

    const creatorId = await resolveCreatorId(db, accountId, handle);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    const existing = await db.query<{ creator_prefs: unknown }>(
      `SELECT creator_prefs FROM creators WHERE id = $1 LIMIT 1`, [creatorId],
    );
    const prev = asPrefs(existing[0]?.creator_prefs);
    const prevCard = (prev.rate_card && typeof prev.rate_card === 'object' ? prev.rate_card : {}) as RateCardStored;

    // Merge item-level so a patch that only sends one field keeps the rest.
    const mergedCard: RateCardStored = {
      rates: { ...(prevCard.rates ?? {}), ...(patch.rates ?? {}) },
      enabled: { ...(prevCard.enabled ?? {}), ...(patch.enabled ?? {}) },
      note: 'note' in patch ? patch.note : prevCard.note,
    };
    const merged = { ...prev, rate_card: mergedCard };

    await db.update('creators', { id: creatorId }, {
      creator_prefs: JSON.stringify(merged),
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ saved: true, ...(await cardFor(db, creatorId)) });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
