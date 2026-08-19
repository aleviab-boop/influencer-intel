'use client';

import { useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { setBrandSession } from '@/lib/brand-session';
import { addBrandToRoster } from '@/lib/agency-session';

interface BrandDna {
  brand: string;
  summary: string;
  category: string;
  positioning: string;
  values: string[];
  personality: string[];
  target_audience: string;
  aesthetic: string;
  content_pillars: string[];
  keywords: string[];
  creator_archetypes: string[];
  competitors: string[];
  opportunities: string[];
}

export default function BrandDnaPage() {
  const [brand, setBrand] = useState('');
  const [url, setUrl] = useState('');
  const [social, setSocial] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dna, setDna] = useState<BrandDna | null>(null);
  const [saved, setSaved] = useState(false);

  async function analyse(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (brand.trim().length < 2) {
      setError('Enter a brand name.');
      return;
    }
    setLoading(true);
    setDna(null);
    try {
      const r = await fetch('/api/brand/dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: brand.trim(),
          url: url.trim() || undefined,
          social: social.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || 'Could not analyse the brand. Try again.');
        setLoading(false);
        return;
      }
      setDna(d.profile ?? null);
      setSaved(!!d.saved);
      // Sign the brand in: stash the analysed context so every brand surface
      // (workspace, campaign ideas, scoped discovery) is personalised to them.
      if (d.profile) {
        setBrandSession({
          brand: brand.trim(),
          url: url.trim() || null,
          social: social.trim() || null,
          mode: 'barter',
          dna: d.profile,
          ts: Date.now(),
        });
        // Add to the agency's roster so it appears in the workspace switcher.
        addBrandToRoster({
          brand: brand.trim(),
          url: url.trim() || null,
          social: social.trim() || null,
          category: d.profile.category ?? null,
          dna: d.profile,
          ts: Date.now(),
        });
      }
    } catch {
      setError('Could not reach the server. Try again.');
    }
    setLoading(false);
  }

  const campaignHref = dna
    ? `/brand-campaigns?brand=${encodeURIComponent(dna.brand || brand.trim())}&category=${encodeURIComponent(dna.category || '')}&audience=${encodeURIComponent(dna.target_audience || '')}`
    : '/brand-campaigns';

  return (
    <div className="min-h-screen bg-[#fafafc] font-sans">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <header className="mb-8">
          <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
            Brand login
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-900">Sign in your brand</h1>
          <p className="mt-2 text-[15px] text-ink-600 max-w-2xl">
            Give us the brand&apos;s name, website and social handle. We read the actual site and profiles, distil a
            structured brand DNA — positioning, voice, audience and the creators that fit — and use it to personalise
            your whole workspace: campaigns, creators and trends, all scoped to your brand.
          </p>
          <a href="/brand/login" className="inline-block mt-3 text-[13px] font-semibold" style={{ color: ACCENT }}>
            Already set up a brand? Sign in →
          </a>
        </header>

        {/* Input form */}
        <form onSubmit={analyse} className="rounded-2xl bg-white border border-border shadow-card p-6 grid sm:grid-cols-2 gap-4">
          <Field label="Brand name" required>
            <input className={inp} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. GlowRoot" />
          </Field>
          <Field label="Website URL">
            <input className={inp} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="e.g. glowroot.in" />
          </Field>
          <Field label="Instagram handle / URL">
            <input className={inp} value={social} onChange={(e) => setSocial(e.target.value)} placeholder="e.g. @glowroot" />
          </Field>
          <Field label="Anything else (optional)">
            <input className={inp} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. new sunscreen launch" />
          </Field>

          <div className="sm:col-span-2 flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-70 flex items-center gap-2"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              {loading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
              {loading ? 'Analysing brand…' : 'Analyse brand DNA'}
            </button>
            {error && <span className="text-[13px] text-rose-600">{error}</span>}
          </div>
        </form>

        {loading && (
          <p className="mt-8 text-center text-[14px] text-ink-500">Reading the website and socials, distilling the DNA…</p>
        )}

        {/* Result */}
        {dna && !loading && (
          <div className="mt-8 rounded-2xl bg-white border border-border shadow-card overflow-hidden">
            <div className="p-6 border-b border-border">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-[20px] font-bold text-ink-900">{dna.brand || brand.trim()}</h2>
                  {dna.summary && <p className="mt-1 text-[14px] text-ink-600 max-w-2xl">{dna.summary}</p>}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {dna.category && <Pill>{dna.category}</Pill>}
                  {!saved && <span className="text-[11px] text-ink-400 self-center">not saved</span>}
                </div>
              </div>
              {dna.positioning && (
                <p className="mt-3 text-[13.5px] text-ink-700"><span className="font-semibold text-ink-800">Positioning:</span> {dna.positioning}</p>
              )}
              {dna.target_audience && (
                <p className="mt-1.5 text-[13.5px] text-ink-700"><span className="font-semibold text-ink-800">Audience:</span> {dna.target_audience}</p>
              )}
              {dna.aesthetic && (
                <p className="mt-1.5 text-[13.5px] text-ink-700"><span className="font-semibold text-ink-800">Aesthetic:</span> {dna.aesthetic}</p>
              )}
            </div>

            <div className="p-6 grid sm:grid-cols-2 gap-x-8 gap-y-5">
              <TagList label="Brand values" items={dna.values} />
              <TagList label="Personality / voice" items={dna.personality} />
              <TagList label="Content pillars" items={dna.content_pillars} />
              <TagList label="Fitting creator types" items={dna.creator_archetypes} />
              <TagList label="Discovery keywords" items={dna.keywords} />
              <TagList label="Competitors / peers" items={dna.competitors} />
            </div>

            {dna.opportunities?.length > 0 && (
              <div className="px-6 pb-6">
                <div className="rounded-xl p-4" style={{ background: ACCENT_SOFT }}>
                  <div className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: ACCENT }}>
                    Ways to market better
                  </div>
                  <ul className="space-y-1.5">
                    {dna.opportunities.map((o) => (
                      <li key={o} className="text-[13.5px] text-ink-700 flex gap-2">
                        <span style={{ color: ACCENT }}>→</span>
                        <span>{o}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="border-t border-border bg-[#fafafc] px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[12.5px] text-ink-500">
                {saved ? 'Signed in — your workspace is now personalised to this brand.' : 'This DNA was generated but not saved.'}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={campaignHref}
                  className="px-4 py-2 rounded-xl text-[13px] font-semibold border border-border text-ink-700 bg-white"
                >
                  Campaign ideas →
                </a>
                <a
                  href="/brand/home"
                  className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold"
                  style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
                >
                  Enter brand workspace →
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize" style={{ background: ACCENT_SOFT, color: ACCENT }}>
      {children}
    </span>
  );
}

function TagList({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span key={it} className="text-[12.5px] px-2.5 py-1 rounded-lg bg-ink-50 border border-border text-ink-700">{it}</span>
        ))}
      </div>
    </div>
  );
}

const inp =
  'w-full px-3.5 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all';
