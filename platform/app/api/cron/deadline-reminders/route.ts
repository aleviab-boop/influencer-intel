import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { emailEnabled, sendDeadlineReminder, type DeadlineReminder } from '@/lib/email';

export const runtime = 'nodejs';

const IST_OFFSET_MIN = 5 * 60 + 30;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// "Tomorrow" in IST as YYYY-MM-DD — creators bill INR/IST, and due_date is a DATE.
function istTomorrow(): string {
  const t = new Date(Date.now() + IST_OFFSET_MIN * 60_000 + 86_400_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

interface DueRow {
  recruit_id: string;
  creator_id: string;
  email: string | null;
  creator_name: string | null;
  brand: string | null;
  program: string | null;
  rate: string | number | null;
  due_date: string;
  program_id: string;
  brand_id: string | null;
}

/**
 * GET /api/cron/deadline-reminders
 *
 * Daily scan that emails a creator the day BEFORE an unpaid deliverable is due,
 * so the reminder lands exactly once per deal (no dedup state needed). Skips
 * declined/paid rows and anyone without an email on file. No-ops cleanly when
 * email isn't configured. Optional CRON_SECRET guard (Vercel cron sends it).
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
  const dueOn = istTomorrow();

  try {
    const rows = await db.query<DueRow>(
      `SELECT pr.id AS recruit_id, pr.creator_id,
              COALESCE(NULLIF(c.email, ''), c.verified_oauth_data->>'email') AS email,
              COALESCE(NULLIF(c.display_name, ''), c.handle)                 AS creator_name,
              b.name AS brand, p.name AS program, pr.rate,
              pr.due_date::text AS due_date,
              pr.program_id, p.brand_id
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN brands b ON b.id = p.brand_id
       JOIN creators c ON c.id = pr.creator_id
       WHERE pr.status <> 'declined'
         AND pr.paid = false
         AND pr.due_date = $1`,
      [dueOn],
    );

    const dueLabel = `tomorrow, ${new Date(dueOn + 'T00:00:00Z').toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', timeZone: 'UTC',
    })}`;

    let sent = 0;
    let skipped = 0;
    for (const r of rows) {
      if (!r.email) { skipped++; continue; }
      const reminder: DeadlineReminder = {
        email: r.email,
        creator_name: r.creator_name ?? 'there',
        brand: r.brand ?? 'A brand',
        program: r.program ?? 'your campaign',
        recruit_id: r.recruit_id,
        due_label: dueLabel,
        rate: num(r.rate),
        creator_id: r.creator_id,
        program_id: r.program_id,
        brand_id: r.brand_id,
      };
      const ok = await sendDeadlineReminder(reminder);
      if (ok) sent++; else skipped++;
    }

    return NextResponse.json({ due_on: dueOn, candidates: rows.length, sent, skipped });
  } catch (err) {
    console.error('[cron] deadline-reminders failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
