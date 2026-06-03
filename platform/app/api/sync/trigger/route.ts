import { NextResponse } from 'next/server';
import { syncConnectedAccount } from '@/lib/sync-worker';

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json() as { account_id: string };
  if (!body.account_id) {
    return NextResponse.json({ error: 'account_id required' }, { status: 400 });
  }
  try {
    const result = await syncConnectedAccount(body.account_id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
