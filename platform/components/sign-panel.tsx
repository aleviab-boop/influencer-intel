'use client';

import { useState } from 'react';
import { ACCENT } from '@/components/marketing';

// Typed-name e-signature panel shared by the creator and brand contract pages.
// Hidden when printing. The viewer affirms the terms and types their legal name;
// the parent records it (POST) and refetches the rebuilt contract.
export function SignPanel({
  heading,
  subline,
  defaultName,
  onSign,
}: {
  heading: string;
  subline: string;
  defaultName: string;
  onSign: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = name.trim().length >= 2 && agree && !busy;

  return (
    <div className="max-w-2xl mx-auto mb-4 rounded-2xl bg-white border-2 shadow-card p-5 print:hidden"
      style={{ borderColor: ACCENT }}>
      <div className="text-[15px] font-bold text-ink-900">{heading}</div>
      <p className="mt-1 text-[12.5px] text-ink-500 leading-relaxed">{subline}</p>

      <label className="block mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Full legal name</label>
      <input
        value={name}
        onChange={(e) => { setName(e.target.value); setErr(null); }}
        placeholder="e.g. Priya Sharma"
        className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 text-[14px] text-ink-900 outline-none focus:ring-2"
        style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}
      />

      <label className="mt-3 flex items-start gap-2.5 cursor-pointer select-none">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#6C4DF6]" />
        <span className="text-[12.5px] text-ink-600 leading-relaxed">
          I have read and agree to the terms of this agreement. I understand that typing my name and clicking &ldquo;Sign&rdquo; constitutes my electronic signature and is legally binding.
        </span>
      </label>

      {err && <p className="mt-2 text-[12px] text-red-500">{err}</p>}

      <button
        disabled={!ready}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await onSign(name.trim());
          } catch {
            setErr('Could not record your signature. Please try again.');
          } finally {
            setBusy(false);
          }
        }}
        className="mt-4 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:brightness-105 enabled:hover:-translate-y-0.5"
        style={{ background: ACCENT }}
      >
        {busy ? 'Signing…' : 'Sign agreement'}
      </button>
    </div>
  );
}
