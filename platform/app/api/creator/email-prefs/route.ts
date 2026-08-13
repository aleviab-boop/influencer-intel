import { NextResponse } from 'next/server';
import { resolveCreatorId } from '@/lib/creator-identity';
import {
  loadEmailPrefs,
  saveEmailPrefs,
  EMAIL_PREF_KEYS,
  type EmailPrefs,
} from '@/lib/creator-email-prefs';

export const runtime = 'nodejs';

/** GET /api/creator/email-prefs?handle=|account= — the creator's opt-out flags. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });
    const prefs = await loadEmailPrefs(creatorId);
    return NextResponse.json({ available: true, prefs });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * PATCH /api/creator/email-prefs?handle=|account=
 * Body: { invite?, payment?, review?, deadline? } (booleans)
 * Toggle one or more email categories on/off. Preserves other creator_prefs.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<EmailPrefs> = {};
    for (const k of EMAIL_PREF_KEYS) {
      if (typeof body[k] === 'boolean') patch[k] = body[k] as boolean;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ available: true, saved: false, error: 'no valid flags' }, { status: 200 });
    }
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });
    const prefs = await saveEmailPrefs(creatorId, patch);
    return NextResponse.json({ available: true, saved: true, prefs });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
