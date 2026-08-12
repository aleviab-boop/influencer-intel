'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Profile {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  primary_category: string | null;
  primary_city: string | null;
  profile_photo_url: string | null;
  follower_count: number | string | null;
  engagement_rate: number | string | null;
  is_verified: boolean | null;
}
type EditableField = 'display_name' | 'bio' | 'primary_category' | 'primary_city';
const LIMITS: Record<EditableField, number> = { display_name: 80, bio: 500, primary_category: 60, primary_city: 60 };

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const [handle, setHandle] = useState<string | null>(null);
  const [qs, setQs] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<EditableField, string>>({ display_name: '', bio: '', primary_category: '', primary_city: '' });
  const [errors, setErrors] = useState<Partial<Record<EditableField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    const query = h ? `?handle=${encodeURIComponent(h.replace(/^@/, ''))}` : '';
    setQs(query);
    fetch(`/api/creator/profile${query}`)
      .then((r) => r.json())
      .then((d: { available: boolean; profile?: Profile }) => {
        if (d.available && d.profile) {
          setProfile(d.profile);
          setForm({
            display_name: d.profile.display_name ?? '',
            bio: d.profile.bio ?? '',
            primary_category: d.profile.primary_category ?? '',
            primary_city: d.profile.primary_city ?? '',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = (field: EditableField, value: string): void => {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/creator/profile${qs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = (await res.json()) as { saved?: boolean; profile?: Profile; errors?: Partial<Record<EditableField, string>> };
      if (d.errors && Object.keys(d.errors).length) {
        setErrors(d.errors);
      } else if (d.saved && d.profile) {
        setProfile(d.profile);
        setSaved(true);
      }
    } catch {
      /* keep the form; user can retry */
    } finally {
      setSaving(false);
    }
  };

  const backHref = handle ? `/creator?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator';

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        <Link href={backHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors duration-200 mb-5">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to dashboard
        </Link>

        <h1 className="text-2xl font-bold text-ink-900">Profile settings</h1>
        <p className="mt-1.5 text-[14px] text-ink-600">These details power your media kit and how brands find you. Keep them accurate.</p>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !profile ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <h2 className="text-[16px] font-semibold text-ink-900">Profile not found</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500">We couldn\u2019t match your handle. Open the portal with your handle to edit settings.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {/* Identity (read-only) */}
            <div className="rounded-2xl bg-white border border-border shadow-card p-5 flex items-center gap-4">
              {profile.profile_photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.profile_photo_url} alt="" className="h-14 w-14 rounded-xl object-cover" />
              ) : (
                <div className="h-14 w-14 rounded-xl grid place-items-center text-white text-xl font-bold" style={{ background: ACCENT }}>
                  {profile.handle?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-[15px] font-bold text-ink-900">@{profile.handle}</div>
                <div className="text-[12.5px] text-ink-400">Handle and stats are managed automatically.</div>
              </div>
            </div>

            {/* Ownership verification */}
            <OwnershipCard />

            {/* Editable form */}
            <div className="rounded-2xl bg-white border border-border shadow-card p-5 space-y-4">
              <Field label="Display name" hint="Your name as brands should see it.">
                <input
                  value={form.display_name}
                  onChange={(e) => update('display_name', e.target.value)}
                  maxLength={LIMITS.display_name + 20}
                  placeholder="e.g. Aditi Sharma"
                  className="w-full rounded-lg border border-border px-3 py-2 text-[14px] text-ink-900 focus:outline-none focus:border-[#b9aef0]"
                />
                <Err msg={errors.display_name} count={form.display_name.length} max={LIMITS.display_name} />
              </Field>

              <Field label="Bio" hint="A short pitch — what you make and who you make it for.">
                <textarea
                  value={form.bio}
                  onChange={(e) => update('bio', e.target.value)}
                  rows={4}
                  placeholder="Fashion & lifestyle creator based in Mumbai. I make honest try-on hauls and travel reels."
                  className="w-full rounded-lg border border-border px-3 py-2 text-[14px] text-ink-900 leading-relaxed resize-y focus:outline-none focus:border-[#b9aef0]"
                />
                <Err msg={errors.bio} count={form.bio.length} max={LIMITS.bio} />
              </Field>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Primary category" hint="Your main niche.">
                  <input
                    value={form.primary_category}
                    onChange={(e) => update('primary_category', e.target.value)}
                    placeholder="e.g. Fashion"
                    className="w-full rounded-lg border border-border px-3 py-2 text-[14px] text-ink-900 focus:outline-none focus:border-[#b9aef0]"
                  />
                  <Err msg={errors.primary_category} count={form.primary_category.length} max={LIMITS.primary_category} />
                </Field>
                <Field label="Primary city" hint="Where you\u2019re based.">
                  <input
                    value={form.primary_city}
                    onChange={(e) => update('primary_city', e.target.value)}
                    placeholder="e.g. Mumbai"
                    className="w-full rounded-lg border border-border px-3 py-2 text-[14px] text-ink-900 focus:outline-none focus:border-[#b9aef0]"
                  />
                  <Err msg={errors.primary_city} count={form.primary_city.length} max={LIMITS.primary_city} />
                </Field>
              </div>
            </div>

            {/* Save bar */}
            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-60 transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {saved && (
                <span className="text-[13px] font-semibold px-2.5 py-1 rounded-lg" style={{ color: '#16a34a', background: '#ecfdf3' }}>✓ Saved</span>
              )}
              <Link href={`/creator/media-kit${qs}`} className="ml-auto text-[13px] font-semibold" style={{ color: ACCENT }}>
                Preview media kit →
              </Link>
            </div>

            {/* Payout link */}
            <Link href={`/creator/payout${qs}`} className="group flex items-center justify-between gap-3 rounded-2xl bg-white border border-border shadow-card px-5 py-4 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-ink-900">Payout details</div>
                  <div className="text-[12px] text-ink-400">Set how your deal payments reach you</div>
                </div>
              </div>
              <svg className="text-ink-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </Link>

            {/* Rate card link */}
            <Link href={`/creator/rate-card${qs}`} className="group flex items-center justify-between gap-3 rounded-2xl bg-white border border-border shadow-card px-5 py-4 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-ink-900">Rate card</div>
                  <div className="text-[12px] text-ink-400">Set your price per deliverable to share with brands</div>
                </div>
              </div>
              <svg className="text-ink-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </Link>

            <p className="text-[12px] text-ink-400 rounded-xl p-3" style={{ background: ACCENT_SOFT }}>
              Changes here update your public media kit and how you appear in brand searches.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Ownership verification card. Reads the creator session for their claim state:
 *   • verified → a green "Verified owner" badge
 *   • claimed but unverified → shows the bio code + a "Check my bio" button
 *   • no claim code (OAuth-only / preview) → renders nothing
 */
function OwnershipCard() {
  const [state, setState] = useState<{ verified: boolean | null; code: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/creator/session')
      .then((r) => r.json())
      .then((d: { claim_verified?: boolean | null; claim_code?: string | null }) => {
        if (d.claim_verified === undefined && !d.claim_code) return;
        setState({ verified: d.claim_verified ?? null, code: d.claim_code ?? null });
      })
      .catch(() => {});
  }, []);

  if (!state || (state.verified === null && !state.code)) return null;

  if (state.verified) {
    return (
      <div className="rounded-2xl bg-white border border-border shadow-card p-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl grid place-items-center bg-emerald-50 text-emerald-600">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <div>
          <div className="text-[14px] font-semibold text-ink-900">Verified owner</div>
          <div className="text-[12px] text-ink-400">You&apos;ve confirmed you own this Instagram account.</div>
        </div>
      </div>
    );
  }

  async function check() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/creator/auth/verify', { method: 'POST' });
      const d = (await res.json().catch(() => null)) as { verified?: boolean } | null;
      if (d?.verified) {
        setState({ verified: true, code: null });
      } else {
        setMsg("Not found in your bio yet — save the code, wait a moment, then check again.");
      }
    } catch {
      setMsg('Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white border border-border shadow-card p-5">
      <div className="text-[14px] font-semibold text-ink-900">Verify ownership</div>
      <div className="text-[12.5px] text-ink-500 mt-0.5">
        Add this code to your Instagram bio, then check — it earns you a verified badge and
        unlocks payouts.
      </div>
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <code className="px-3 py-1.5 rounded-lg text-[14px] font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
          {state.code}
        </code>
        <button
          onClick={check}
          disabled={busy}
          className="px-4 py-2 text-[13px] font-semibold text-white rounded-xl disabled:opacity-60"
          style={{ background: ACCENT }}
        >
          {busy ? 'Checking…' : 'Check my bio'}
        </button>
      </div>
      {msg && <div className="mt-2.5 text-[12px] text-amber-700">{msg}</div>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-ink-800">{label}</label>
      {hint && <div className="text-[11.5px] text-ink-400 mb-1.5">{hint}</div>}
      {children}
    </div>
  );
}

function Err({ msg, count, max }: { msg?: string; count: number; max: number }) {
  return (
    <div className="mt-1 flex items-center justify-between">
      <span className="text-[11.5px]" style={{ color: msg ? '#dc2626' : 'transparent' }}>{msg || '.'}</span>
      <span className="text-[11px] tabular-nums" style={{ color: count > max ? '#dc2626' : '#9a97ad' }}>{count}/{max}</span>
    </div>
  );
}
