// Minimal superadmin gate — separate from the agency/influencer user auth.
// A single ADMIN_PASSWORD unlocks the /admin panel; the cookie stores a hash of
// (password + SESSION_SECRET) so it can't be forged without the password.
// Uses Web Crypto so it works in both the Node API route and Edge middleware.

export const ADMIN_COOKIE = 'ii_admin';
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? 'admin';
}

export async function adminToken(): Promise<string> {
  const secret = `${adminPassword()}:${process.env.SESSION_SECRET ?? 'change-me-in-prod-influencer-intel-dev'}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function isValidAdminToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  return token === (await adminToken());
}
