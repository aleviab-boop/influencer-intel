import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, isValidAdminToken } from '@/lib/admin-auth';

// Gate the /admin panel + its APIs behind the superadmin password. The login
// page and the auth endpoint itself are always reachable (otherwise you could
// never sign in).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow the login page and the auth API through.
  if (pathname === '/admin/login' || pathname === '/api/admin/auth') {
    return NextResponse.next();
  }

  const valid = await isValidAdminToken(req.cookies.get(ADMIN_COOKIE)?.value);

  if (pathname.startsWith('/api/admin')) {
    if (!valid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.next();
  }

  // /admin pages
  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
