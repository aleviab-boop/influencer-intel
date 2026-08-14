import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { emailEnabled, sendBrandDigest, type BrandDigestItem } from '@/lib/email';
import { buildBrandNotifications, type BrandNotificationInput } from '@/lib/brand-notifications';

export const runtime = 'nodejs';

const MAX_ITEMS = 8; // top items per digest; the app holds the rest

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface BrandRow {
  id: string;
  name: string | null;
  email: string;
}

interface RecruitRow {
  recruit_id: string;
  program_id: string;
  program_name: string | null;
  handle: string | null;
  display_name: string | null;
  status: string;
  rate: string | number | null;
  paid: boolean;
  due_date: string | null;
  updated_at: string | null;
  created_at: string | null;
  submissions: unknown;
}

/**
 * GET /api/cron/brand-digest
 *
 * Weekly roll-up: for every brand with an email on file, builds their in-app
 * notification feed (the same buildBrandNotifications the /notifications page
 * uses) and emails the top items — creators who responded, submissions to
 * review, deals ready to pay, invites gone quiet, overdue deliverables. Only
 * sends when there's at least one action item, so a quiet week mails nothing.
 * Scoped strictly to each brand's own programs (no shared/demo rows in email).
 * No-ops when email isn't configured. Optional CRON_SECRET guard.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!emailEnabled()) {
    return NextResponse.json({ skipped: 'email_disabled', sent: 0 });
  }

  const db = getBolticClient();
  const nowISO = new Date().toISOString();

  try {
    const brands = await db.query<BrandRow>(
      `SELECT id, name, email FROM brands
       WHERE email IS NOT NULL AND email <> ''`,
    );

    let sent = 0;
    let quiet = 0;
    let skipped = 0;

    for (const brand of brands) {
      const rows = await db.query<RecruitRow>(
        `SELECT pr.id AS recruit_id, pr.program_id,
                p.name AS program_name,
                c.handle, c.display_name,
                pr.status, pr.rate, pr.paid,
                pr.due_date::text AS due_date,
                pr.updated_at::text AS updated_at,
                pr.created_at::text AS created_at,
                pr.submissions
         FROM program_recruits pr
         JOIN programs p ON p.id = pr.program_id
         JOIN creators c ON c.id = pr.creator_id
         WHERE p.brand_id = $1`,
        [brand.id],
      );

      const items: BrandNotificationInput[] = rows.map((r) => ({
        recruit_id: r.recruit_id,
        program_id: r.program_id,
        program: r.program_name ?? 'Campaign',
        creator: r.display_name || (r.handle ? `@${r.handle}` : 'A creator'),
        status: r.status,
        rate: num(r.rate),
        paid: !!r.paid,
        due_date: r.due_date ? r.due_date.slice(0, 10) : null,
        updated_at: r.updated_at,
        created_at: r.created_at,
        submissions: r.submissions,
      }));

      const feed = buildBrandNotifications(items, nowISO);

      // Only worth an email when something actually needs them.
      if (!feed.available || feed.action_count === 0) { quiet++; continue; }

      const digestItems: BrandDigestItem[] = feed.items.slice(0, MAX_ITEMS).map((n) => ({
        title: n.title,
        body: n.body,
        when_label: n.when_label,
        severity: n.severity,
      }));

      const ok = await sendBrandDigest({
        to: brand.email,
        brand_id: brand.id,
        brand_name: brand.name || 'there',
        action_count: feed.action_count,
        total: feed.total,
        items: digestItems,
      });
      if (ok) sent++; else skipped++;
    }

    return NextResponse.json({ brands: brands.length, sent, quiet, skipped });
  } catch (err) {
    console.error('[cron] brand-digest failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
