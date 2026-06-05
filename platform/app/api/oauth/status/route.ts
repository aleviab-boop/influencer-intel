import { NextResponse } from 'next/server';
import { isOAuthConfigured } from '@/lib/oauth-service';

export const runtime = 'nodejs';

// GET /api/oauth/status → whether Instagram login is set up (app credentials present)
export function GET() {
  return NextResponse.json({ configured: isOAuthConfigured() });
}
