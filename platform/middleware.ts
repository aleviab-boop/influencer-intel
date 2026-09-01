import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, isValidAdminToken } from '@/lib/admin-auth';

// Names of the signed session cookies (mirror the *_COOKIE_NAME consts in
// lib/auth). Hardcoded here so middleware stays on the Edge runtime without
// pulling Node's `crypto` in via lib/auth.
const CREATOR_COOKIE = 'ii_creator'; // Instagram creator OAuth session
const AGENCY_COOKIE = 'ii_agency'; // brand + agency accounts (account_type)
const BRAND_COOKIE = 'ii_session'; // legacy brand session

// True if ANY signed-in session cookie is present. Middleware only checks
// PRESENCE (the authoritative signature check runs server-side in the matching
// API routes) — enough to route logged-out visitors to the /login hero and let
// signed-in users reach the /lander home.
function hasAnySession(req: NextRequest): boolean {
  return (
    !!req.cookies.get(AGENCY_COOKIE)?.value ||
    !!req.cookies.get(CREATOR_COOKIE)?.value ||
    !!req.cookies.get(BRAND_COOKIE)?.value ||
    !!req.cookies.get(ADMIN_COOKIE)?.value
  );
}

// Gate the /admin panel + its APIs behind the superadmin password, and soft-gate
// the /creator portal on the Instagram session. Signing in happens on the main
// /login page via the auth/OAuth endpoints, so those stay reachable.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ---- Entry routing -------------------------------------------------------
  // The /login 3-role chooser (Brand / Agency / Influencer) is the hero page
  // for anyone who hasn't logged in. /lander (the search homepage) is the
  // SIGNED-IN home. So:
  //   • root "/"  → /lander when signed in, else /login
  //   • /lander   → allowed only when signed in, else bounced to /login
  // Presence of any session cookie counts as signed in (see hasAnySession).
  if (pathname === '/' || pathname === '/lander') {
    const signedIn = hasAnySession(req);
    if (pathname === '/') {
      const url = req.nextUrl.clone();
      url.pathname = signedIn ? '/lander' : '/login';
      url.search = '';
      return NextResponse.redirect(url);
    }
    // pathname === '/lander'
    if (signedIn) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // ---- Creator portal pages ------------------------------------------------
  // A signed ii_creator cookie is minted on Instagram OAuth. We only check for
  // its PRESENCE here (the authoritative signature check runs server-side in
  // every /api/creator route via getCreatorSession). Preview/demo links that
  // carry ?handle or ?account are always let through so shared demos keep
  // working without a login. The standalone analytics-preview is exempt.
  if (pathname.startsWith('/creator')) {
    // The standalone analytics-preview is a public/shareable page — always let
    // it through (it must NOT fall into the admin gate below).
    if (pathname.startsWith('/creator/analytics-preview')) return NextResponse.next();

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

  // /admin pages → send unauthenticated users to the unlisted staff sign-in.
  // (Admin is no longer a tab on the public /login role chooser — it lives on
  // its own /staff page for internal use only.)
  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = '/staff';
    url.search = ''; // drop any stale query
    // Preserve where they were headed — but never the deleted /admin/login.
    if (pathname !== '/admin/login') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/lander', '/admin/:path*', '/api/admin/:path*', '/creator/:path*'],
};
