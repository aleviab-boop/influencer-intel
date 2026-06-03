'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface SessionState {
  authenticated: boolean;
  email?: string;
  brand_name?: string;
  ig_handle?: string;
}

export function AppHeader() {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionState | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [email, setEmail] = useState('');
  const [brandName, setBrandName] = useState('');
  const [igHandle, setIgHandle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth')
      .then((r) => r.json())
      .then((d) => setSession(d))
      .catch(() => setSession({ authenticated: false }));
  }, []);

  const links = [
    { href: '/creators', label: 'Discover', match: (p: string) => p.startsWith('/creators') || p.startsWith('/insights') },
    { href: '/predict', label: 'Predict', match: (p: string) => p === '/predict' },
    { href: '/briefs', label: 'Briefs', match: (p: string) => p.startsWith('/briefs') || p.startsWith('/shortlist') },
    { href: '/stores', label: 'Stores', match: (p: string) => p.startsWith('/stores') },
  ];

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, brand_name: brandName || undefined, ig_handle: igHandle || undefined }),
      });
      const d = await r.json();
      if (r.ok) {
        setSession({ authenticated: true, email: d.email, brand_name: d.brand_name, ig_handle: d.ig_handle });
        setShowSignIn(false);
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sign_out' }),
    });
    setSession({ authenticated: false });
    window.location.reload();
  }

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[#e5e5e5]">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-[15px] font-semibold tracking-[0.04em] uppercase text-[#111]">
            Influencer Intel
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 text-[13px] tracking-wide transition-colors ${
                  active
                    ? 'text-[#111] font-medium'
                    : 'text-[#999] hover:text-[#111]'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <span className="w-px h-4 bg-[#e5e5e5] mx-3" />
          {session?.authenticated ? (
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-[#999] truncate max-w-[140px]">{session.brand_name}</span>
              <button onClick={handleSignOut} className="text-[11px] text-[#ccc] hover:text-[#111]">
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSignIn((s) => !s)}
              className="px-3 py-1 text-[13px] text-[#999] hover:text-[#111] transition-colors"
            >
              Sign in
            </button>
          )}
        </nav>
      </div>
      {showSignIn && (
        <div className="border-t border-[#f0f0f0] bg-[#fafafa]">
          <form onSubmit={handleSignIn} className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-2">
            <input
              type="email"
              required
              placeholder="you@brand.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 px-3 py-1.5 border border-[#e5e5e5] text-[13px] bg-white focus:outline-none focus:border-[#111] transition-colors"
            />
            <input
              type="text"
              placeholder="Brand name"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="w-36 px-3 py-1.5 border border-[#e5e5e5] text-[13px] bg-white focus:outline-none focus:border-[#111]"
            />
            <input
              type="text"
              placeholder="@ig_handle"
              value={igHandle}
              onChange={(e) => setIgHandle(e.target.value)}
              className="w-32 px-3 py-1.5 border border-[#e5e5e5] text-[13px] bg-white focus:outline-none focus:border-[#111]"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-1.5 bg-[#111] text-white text-[13px] hover:bg-[#333] disabled:opacity-50"
            >
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
            <button type="button" onClick={() => setShowSignIn(false)} className="px-2 py-1 text-[#ccc] hover:text-[#111]">
              &times;
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
