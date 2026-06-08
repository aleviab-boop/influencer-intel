import { NextRequest, NextResponse } from 'next/server';
import { listPayoutMethods, createPayoutMethod, type PayoutMethodType } from '@/lib/payout-methods-service';

export const runtime = 'nodejs';

const TYPES: PayoutMethodType[] = ['upi', 'bank', 'paypal', 'other'];

// GET /api/payout-methods → PayoutMethod[]
export async function GET() {
  try {
    const methods = await listPayoutMethods();
    return NextResponse.json({ methods });
  } catch (err) {
    console.error('[payout-methods] list failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/payout-methods { label, type, detail? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  if (label.length < 2) return NextResponse.json({ error: 'label must be at least 2 characters' }, { status: 400 });
  const type: PayoutMethodType = TYPES.includes(body?.type) ? body.type : 'upi';
  try {
    const method = await createPayoutMethod({ label, type, detail: typeof body.detail === 'string' && body.detail.trim() ? body.detail.trim() : null });
    return NextResponse.json({ method });
  } catch (err) {
    console.error('[payout-methods] create failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
