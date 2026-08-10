import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import {
  buildInvoice,
  type InvoiceDealInput, type InvoiceCreatorInput, type InvoicePayoutInput,
} from '@/lib/invoice';
import { creatorMayAccess } from '@/lib/creator-identity';

export const runtime = 'nodejs';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface Row {
  id: string;
  creator_id: string;
  rate: string | number | null;
  deliverables: string | null;
  due_date: string | null;
  paid: boolean;
  paid_at: string | null;
  program_name: string | null;
  brand_name: string | null;
  handle: string;
  display_name: string | null;
  primary_city: string | null;
  email: string | null;
  payout_details: unknown;
}

function parsePayout(v: unknown): InvoicePayoutInput {
  const obj = typeof v === 'string' ? safeParse(v) : v;
  if (obj && typeof obj === 'object' && 'method' in obj) {
    const r = obj as Record<string, unknown>;
    const method = r.method === 'upi' || r.method === 'bank' ? r.method : null;
    return {
      method,
      upi_id: (r.upi_id as string) ?? null,
      account_holder: (r.account_holder as string) ?? null,
      account_number: (r.account_number as string) ?? null,
      ifsc: (r.ifsc as string) ?? null,
    };
  }
  return { method: null, upi_id: null, account_holder: null, account_number: null, ifsc: null };
}
function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * GET /api/creator/invoice?deal=<recruitId>&gst=<0|18>
 *
 * Builds a brand-billable invoice for a single deal from the deal row plus the
 * creator's own profile and saved payout details (loaded via the deal's
 * creator_id). Full payout details are included — an invoice legitimately shows
 * them. DB-only. Always 200 — `{ available:false }` when the deal doesn't
 * resolve.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const dealId = url.searchParams.get('deal');
  const gstPct = num(url.searchParams.get('gst'));

  if (!dealId) return NextResponse.json({ available: false, reason: 'no_deal' }, { status: 200 });

  const db = getBolticClient();
  try {
    const rows = await db.query<Row>(
      `SELECT pr.id, pr.creator_id, pr.rate, pr.deliverables, pr.due_date::text AS due_date,
              pr.paid, pr.paid_at,
              p.name AS program_name, b.name AS brand_name,
              c.handle, c.display_name, c.primary_city,
              c.verified_oauth_data->>'email' AS email,
              c.payout_details
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN brands b ON b.id = p.brand_id
       JOIN creators c ON c.id = pr.creator_id
       WHERE pr.id = $1
       LIMIT 1`,
      [dealId],
    );

    const r = rows[0];
    if (!r) return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });

    // A logged-in creator may only invoice their own deals (preview unaffected).
    if (!(await creatorMayAccess(r.creator_id))) {
      return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });
    }

    const deal: InvoiceDealInput = {
      id: r.id,
      program: r.program_name ?? 'Campaign',
      brand: r.brand_name ?? 'Brand',
      rate: num(r.rate),
      deliverables: r.deliverables,
      due_date: r.due_date ? r.due_date.slice(0, 10) : null,
      paid: !!r.paid,
      paid_at: r.paid_at,
    };
    const creator: InvoiceCreatorInput = {
      handle: r.handle,
      display_name: r.display_name,
      primary_city: r.primary_city,
      email: r.email,
    };
    const payout = parsePayout(r.payout_details);

    return NextResponse.json(buildInvoice(deal, creator, payout, new Date().toISOString(), gstPct === 18 ? 18 : 0));
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
