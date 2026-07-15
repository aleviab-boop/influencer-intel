import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, isValidAdminToken } from '@/lib/admin-auth';

// Gate the /admin panel + its APIs behind the superadmin password. Signing in
// happens on the main /login page (Admin tab) via the auth endpoint, so that
// endpoint stays reachable; unauthenticated /admin visits redirect there.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
    url.searchParams.set('role', 'admin');
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
