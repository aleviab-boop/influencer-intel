'use client';

// Agency brand switcher — the top-of-workspace dropdown that lets an agency
// managing several brands hop between them. Reads the agency roster (all brands
// they've signed in) and the active brand session, and switches the workspace to
// a chosen brand instantly from its cached DNA.

import { useEffect, useRef, useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { useAgencyRoster, switchToBrand, type AgencyBrand } from '@/lib/agency-session';

const Avatar = ({ name, size = 28 }: { name: string; size?: number }) => (
  <span
    className="rounded-lg grid place-items-center font-bold text-white shrink-0"
    style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
  >
    {name.slice(0, 1).toUpperCase()}
  </span>
);

export function BrandSwitcher({ activeBrand }: { activeBrand: string }) {
  const roster = useAgencyRoster();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeKey = activeBrand.trim().toLowerCase();

  function pick(b: AgencyBrand) {
    setOpen(false);
    if (b.brand.trim().toLowerCase() !== activeKey) switchToBrand(b);
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-xl bg-white border border-border text-[13px] font-semibold text-ink-800 hover:border-[#c9bdfb] transition-colors"
      >
        <Avatar name={activeBrand} size={22} />
        <span className="max-w-[160px] truncate">{activeBrand}</span>
        <span className="text-ink-400 text-[10px]">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-72 rounded-2xl bg-white border border-border shadow-card p-1.5">
          <div className="px-2.5 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Your brands {roster.length > 1 ? `(${roster.length})` : ''}
          </div>
          <div className="max-h-72 overflow-auto">
            {roster.map((b) => {
              const active = b.brand.trim().toLowerCase() === activeKey;
              return (
                <button
                  key={b.brand}
                  onClick={() => pick(b)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left hover:bg-ink-50 transition-colors"
                  style={active ? { background: ACCENT_SOFT } : undefined}
                >
                  <Avatar name={b.brand} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold text-ink-900 truncate">{b.brand}</span>
                    {b.category && <span className="block text-[11.5px] text-ink-500 capitalize truncate">{b.category}</span>}
                  </span>
                  {active && <span className="text-[11px] font-semibold shrink-0" style={{ color: ACCENT }}>Active</span>}
                </button>
              );
            })}
          </div>
          <div className="border-t border-border mt-1.5 pt-1.5 flex flex-col">
            <a href="/brand/login" className="px-2.5 py-2 rounded-xl text-[13px] font-semibold text-ink-700 hover:bg-ink-50 transition-colors">
              Switch / manage brands →
            </a>
            <a href="/brand-dna" className="px-2.5 py-2 rounded-xl text-[13px] font-semibold hover:bg-ink-50 transition-colors" style={{ color: ACCENT }}>
              ＋ Add another brand
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
