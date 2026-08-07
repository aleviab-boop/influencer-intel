import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildBrandInbox, type InboxProgramInput, type InboxRecruitInput } from '@/lib/brand-inbox';

export const runtime = 'nodejs';

const IST_OFFSET_MIN = 5 * 60 + 30;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function istToday(): string {
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${nowIst.getUTCFullYear()}-${pad(nowIst.getUTCMonth() + 1)}-${pad(nowIst.getUTCDate())}`;
}

interface Row {
  program_id: string;
  program_name: string | null;
  creator_id: string;
  handle: string | null;
  display_name: string | null;
  status: string;
  rate: string | number | null;
  paid: boolean;
  due_date: string | null;
  deliverables: string | null;
  submissions: unknown;
  created_at: string | null;
}

/**
 * GET /api/brand/inbox
 *
 * The brand's cross-campaign to-do: applications awaiting a decision, submitted
 * links awaiting a verdict, creators approved and ready to pay, and overdue
 * deliveries — rolled up across every live (non-closed) campaign. No brand
 * isolation (agency/demo pattern, same as the campaign list). Brand HTTP
 * conventions: 500 with { error } on failure.
 */
export async function GET(): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const rows = await db.query<Row>(
      `SELECT pr.program_id, p.name AS program_name,
              pr.creator_id, c.handle, c.display_name, pr.status, pr.rate, pr.paid,
              pr.due_date::text AS due_date, pr.deliverables, pr.submissions,
              pr.created_at::text AS created_at
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       JOIN creators c ON c.id = pr.creator_id
       WHERE p.status <> 'closed'
       ORDER BY pr.created_at DESC`,
    );

    // Group recruits under their program, preserving first-seen program name.
    const byProgram = new Map<string, InboxProgramInput>();
    for (const r of rows) {
      let prog = byProgram.get(r.program_id);
      if (!prog) {
        prog = { program_id: r.program_id, program_name: r.program_name ?? 'Campaign', recruits: [] };
        byProgram.set(r.program_id, prog);
      }
      const recruit: InboxRecruitInput = {
        creator_id: r.creator_id,
        handle: r.handle ?? 'creator',
        display_name: r.display_name,
        status: r.status,
        rate: num(r.rate),
        paid: !!r.paid,
        due_date: r.due_date ? r.due_date.slice(0, 10) : null,
        deliverables: r.deliverables,
        submissions: r.submissions,
        created_at: r.created_at,
      };
      prog.recruits.push(recruit);
    }

    return NextResponse.json(buildBrandInbox([...byProgram.values()], istToday()));
  } catch (err) {
    console.error('[brand] inbox load failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
