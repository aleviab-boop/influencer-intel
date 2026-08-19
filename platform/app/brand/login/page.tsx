'use client';

import { useEffect, useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { setBrandSession, type BrandDnaProfile } from '@/lib/brand-session';

interface SavedBrand {
  brand_name: string;
  category: string | null;
  created_at: string;
}

export default function BrandLoginPage() {
  const [brands, setBrands] = useState<SavedBrand[] | null>(null);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/brand/dna');
        const d = await r.json().catch(() => ({}));
        setBrands(Array.isArray(d.brands) ? d.brands : []);
      } catch {
        setBrands([]);
      }
    })();
  }, []);

  // Restore a brand's saved DNA into the session and open their workspace.
  async function signIn(name: string) {
    const brand = name.trim();
    if (!brand || signingIn) return;
    setSigningIn(brand);
    setError(null);
    try {
      const r = await fetch(`/api/brand/dna?brand=${encodeURIComponent(brand)}`);
      const d = await r.json().catch(() => ({}));
      const dna = (d.profile ?? null) as BrandDnaProfile | null;
      if (!dna) {
        setError(`No saved brand DNA for "${brand}". Set it up first.`);
        setSigningIn(null);
        return;
      }
      setBrandSession({ brand: dna.brand || brand, mode: 'barter', dna, ts: Date.now() });
      window.location.href = '/brand/home';
    } catch {
      setError('Could not sign in. Try again.');
      setSigningIn(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafc] font-sans">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <header className="mb-8 text-center">
          <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
            Brand login
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-900">Sign in to your brand workspace</h1>
          <p className="mt-2 text-[15px] text-ink-600 max-w-xl mx-auto">
            Pick your brand to jump back into a workspace personalised to you — your campaigns, creators and trends,
            exactly where you left off.
          </p>
        </header>

        {error && <p className="mb-4 text-center text-[13px] text-rose-600">{error}</p>}

        {brands === null ? (
          <p className="text-center text-[14px] text-ink-500 py-10">Loading your brands…</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {brands.map((b) => (
              <button
                key={b.brand_name}
                onClick={() => void signIn(b.brand_name)}
                disabled={!!signingIn}
                className="text-left rounded-2xl bg-white border border-border shadow-card p-5 hover:border-[#c9bdfb] transition-colors disabled:opacity-60"
              >
                <div className="w-11 h-11 rounded-xl grid place-items-center text-[17px] font-bold text-white mb-3" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                  {b.brand_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="text-[15.5px] font-bold text-ink-900 truncate">{b.brand_name}</div>
                {b.category && <div className="text-[12.5px] text-ink-500 capitalize truncate">{b.category}</div>}
                <div className="mt-3 text-[12.5px] font-semibold" style={{ color: ACCENT }}>
                  {signingIn === b.brand_name ? 'Signing in…' : 'Enter workspace →'}
                </div>
              </button>
            ))}

            {/* Set up a new brand */}
            <a
              href="/brand-dna"
              className="rounded-2xl border-2 border-dashed border-border p-5 grid place-items-center text-center hover:border-[#c9bdfb] transition-colors min-h-[150px]"
            >
              <div>
                <div className="text-2xl" style={{ color: ACCENT }}>＋</div>
                <div className="mt-1 text-[14px] font-semibold text-ink-800">Set up a new brand</div>
                <div className="text-[12px] text-ink-500">Analyse its DNA from the website</div>
              </div>
            </a>
          </div>
        )}

        {brands !== null && brands.length === 0 && (
          <p className="mt-6 text-center text-[13.5px] text-ink-500">
            No brands yet — set one up to get started.
          </p>
        )}
      </div>
    </div>
  );
}
