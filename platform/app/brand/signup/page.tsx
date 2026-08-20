'use client';

import { useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { setBrandSession, type BrandDnaProfile } from '@/lib/brand-session';
import { addBrandToRoster } from '@/lib/agency-session';

// Dedicated brand signup: create a real credentialed account for a single brand
// (account_type='brand'), then analyse its DNA and drop straight into the
// workspace. One form, two sequential calls:
//   1. /api/brand/auth/signup  → account + ii_agency cookie
//   2. /api/brand/dna          → DNA analysis, stamped with the new account_id
// The account owns exactly one brand (its own); everything account_id-scoped
// (pipeline, outreach) is theirs from the first login. Agencies use /agency/login.

const inp =
  'w-full px-3.5 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all';

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

export default function BrandSignupPage() {
  const [brand, setBrand] = useState('');
  const [url, setUrl] = useState('');
  const [social, setSocial] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'idle' | 'account' | 'dna'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (brand.trim().length < 2) return setError('Enter your brand name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid work email.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');

    setBusy(true);
    try {
      // 1. Create the brand account + session cookie.
      setStep('account');
      const a = await fetch('/api/brand/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, brand: brand.trim() }),
      });
      const ad = await a.json().catch(() => ({}));
      if (!a.ok) {
        setError(ad.error || 'Could not create your account.');
        setBusy(false);
        setStep('idle');
        return;
      }

      // 2. Analyse the brand's DNA — now stamped with the new account_id (cookie).
      setStep('dna');
      const d = await fetch('/api/brand/dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: brand.trim(),
          url: url.trim() || undefined,
          social: social.trim() || undefined,
        }),
      });
      const dd = await d.json().catch(() => ({}));
      const dna = (dd.profile ?? null) as BrandDnaProfile | null;

      // Hydrate the client brand-session so the workspace opens personalised.
      setBrandSession({
        brand: brand.trim(),
        url: url.trim() || null,
        social: social.trim() || null,
        mode: 'barter',
        dna,
        ts: Date.now(),
      });
      if (dna) {
        addBrandToRoster({
          brand: brand.trim(),
          url: url.trim() || null,
          social: social.trim() || null,
          category: dna.category ?? null,
          dna,
          ts: Date.now(),
        });
      }
      window.location.href = '/brand/home';
    } catch {
      setError('Could not reach the server. Try again.');
      setBusy(false);
      setStep('idle');
    }
  }

  const cta =
    step === 'account' ? 'Creating your account…' : step === 'dna' ? 'Analysing your brand…' : 'Create brand account';

  return (
    <div className="min-h-screen bg-[#fafafc] font-sans">
      <div className="max-w-lg mx-auto px-6 py-14">
        <header className="mb-7 text-center">
          <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
            Brand sign-up
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-900">Create your brand account</h1>
          <p className="mt-2 text-[14.5px] text-ink-600">
            Sign in for your own brand — we read your site and socials, distil your brand DNA, and open a workspace
            scoped to you: campaigns, creators, pipeline and outreach, all yours.
          </p>
        </header>

        <form onSubmit={submit} className="rounded-2xl bg-white border border-border shadow-card p-6 space-y-4">
          <Field label="Brand name" required>
            <input className={inp} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. GlowRoot" />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Website URL">
              <input className={inp} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="e.g. glowroot.in" />
            </Field>
            <Field label="Instagram handle">
              <input className={inp} value={social} onChange={(e) => setSocial(e.target.value)} placeholder="e.g. @glowroot" />
            </Field>
          </div>
          <div className="border-t border-border pt-4 space-y-4">
            <Field label="Work email" required>
              <input className={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" autoComplete="email" />
            </Field>
            <Field label="Password" required>
              <input className={inp} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
            </Field>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full px-5 py-3 rounded-xl text-white text-[14px] font-semibold disabled:opacity-70 flex items-center justify-center gap-2"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
          >
            {busy && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
            {cta}
          </button>
          {error && <p className="text-[13px] text-rose-600 text-center">{error}</p>}
        </form>

        <p className="mt-5 text-center text-[13px] text-ink-500">
          Already have a brand account?{' '}
          <a href="/brand/login" className="font-semibold" style={{ color: ACCENT }}>Sign in</a>
        </p>
        <p className="mt-1.5 text-center text-[12.5px] text-ink-400">
          Managing brands for clients? <a href="/agency/login" className="font-semibold text-ink-500 hover:text-ink-700">Agency login →</a>
        </p>
      </div>
    </div>
  );
}
