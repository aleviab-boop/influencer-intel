import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, isValidAdminToken } from '@/lib/admin-auth';

// Name of the signed creator-session cookie (mirrors CREATOR_COOKIE_NAME in
// lib/auth). Hardcoded here so middleware stays on the Edge runtime without
// pulling Node's `crypto` in via lib/auth.
const CREATOR_COOKIE = 'ii_creator';

// Gate the /admin panel + its APIs behind the superadmin password, and soft-gate
// the /creator portal on the Instagram session. Signing in happens on the main
// /login page via the auth/OAuth endpoints, so those stay reachable.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ---- Creator portal pages ------------------------------------------------
  // A signed ii_creator cookie is minted on Instagram OAuth. We only check for
  // its PRESENCE here (the authoritative signature check runs server-side in
  // every /api/creator route via getCreatorSession). Preview/demo links that
  // carry ?handle or ?account are always let through so shared demos keep
  // working without a login. The standalone analytics-preview is exempt.
  if (pathname.startsWith('/creator') && !pathname.startsWith('/creator/analytics-preview')) {
    const hasSession = !!req.cookies.get(CREATOR_COOKIE)?.value;
    const hasPreview = req.nextUrl.searchParams.has('handle') || req.nextUrl.searchParams.has('account');
    if (hasSession || hasPreview) return NextResponse.next();

    const dest = req.nextUrl.clone();
    dest.pathname = '/login';
    dest.search = '';
    dest.searchParams.set('role', 'influencer');
    dest.searchParams.set('next', pathname);
    return NextResponse.redirect(dest);
  }

  // Always allow the auth API through (otherwise you could never sign in).
  if (pathname === '/api/admin/auth') {
    return NextResponse.next();
  }

  const valid = await isValidAdminToken(req.cookies.get(ADMIN_COOKIE)?.value);

  if (pathname.startsWith('/api/admin')) {
    if (!valid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.next();
  }

  // /admin pages → send unauthenticated users to the main login (Admin tab).
  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = ''; // drop any stale query
    url.searchParams.set('role', 'admin');
    // Preserve where they were headed — but never the deleted /admin/login.
    if (pathname !== '/admin/login') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*', '/creator/:path*'],
};
