'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';

export interface FeatureSection {
  title: string;
  bullets: string[];
  mock: React.ReactNode;
}

// Reusable scrollable feature page (hero + alternating mock sections + stats + FAQ).
export function FeaturePage({
  hero,
  sections,
  faqs,
  ctaHref = '/lander',
}: {
  hero: { title: string; subtitle: string; mock: React.ReactNode };
  sections: FeatureSection[];
  faqs: { q: string; a: string }[];
  ctaHref?: string;
}) {
  return (
    <div className="min-h-screen bg-white text-[#111] font-sans">
      <MarketingNav />
      <section className="grid-bg">
        <div className="max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.08]">{hero.title}</h1>
            <p className="mt-5 text-[17px] text-[#555] max-w-xl">{hero.subtitle}</p>
            <Link href={ctaHref} className="mt-7 inline-block px-6 py-3 rounded-xl text-white text-[15px] font-medium" style={{ background: ACCENT }}>
              Get Started →
            </Link>
          </div>
          {hero.mock}
        </div>
      </section>

      {sections.map((s, i) => (
        <section key={s.title} className="border-t border-[#f0f0f0]">
          <div className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
            <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">{s.title}</h2>
              <ul className="mt-5 space-y-3">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-3 text-[15px] text-[#555] leading-relaxed">
                    <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ACCENT }} />
                    {b}
                  </li>
                ))}
              </ul>
              <Link href={ctaHref} className="mt-6 inline-flex items-center gap-1 text-[15px] font-medium" style={{ color: ACCENT }}>
                Get Started →
              </Link>
            </div>
            <div className={i % 2 === 1 ? 'lg:order-1' : ''}>{s.mock}</div>
          </div>
        </section>
      ))}

      <StatsBand />
      <FAQ faqs={faqs} />
      <MarketingFooter />
    </div>
  );
}

function StatsBand() {
  const stats = [['2.4M+', 'Creators indexed'], ['14+', 'Categories'], ['10+', 'Indian languages'], ['12+', 'Data metrics']];
  return (
    <section className="py-16" style={{ background: '#111' }}>
      <div className="max-w-6xl mx-auto px-6 text-center text-white">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Data-driven influencer marketing platform</h2>
        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map(([k, v]) => (
            <div key={v}>
              <div className="text-3xl md:text-4xl font-bold" style={{ color: '#b9a8ff' }}>{k}</div>
              <div className="mt-1 text-[13px] text-[#aaa]">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ({ faqs }: { faqs: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="py-20" style={{ background: ACCENT_SOFT }}>
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-10">Frequently asked questions</h2>
        <div className="space-y-2">
          {faqs.map((f, i) => (
            <div key={f.q} className="rounded-xl bg-white border border-[#FFE7DD]">
              <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between px-5 py-4 text-left">
                <span className="text-[15px] font-medium">{f.q}</span>
                <span className="text-[20px] leading-none" style={{ color: ACCENT }}>{open === i ? '−' : '+'}</span>
              </button>
              {open === i && <p className="px-5 pb-4 text-[14px] text-[#555] leading-relaxed">{f.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- reusable mock toolkit ---------------------------------------------

export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white border border-[#eaeaea] shadow-[0_12px_50px_rgba(0,0,0,0.08)] ${className}`}>{children}</div>;
}

export function MockStats({ items }: { items: [string, string][] }) {
  return (
    <Panel className="p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-[#eee] p-3">
            <div className="text-[20px] font-bold tabular-nums">{v}</div>
            <div className="text-[11px] text-[#999]">{k}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function MockTable({ cols, rows }: { cols: string[]; rows: string[][] }) {
  return (
    <Panel className="p-4 overflow-hidden">
      <div className="grid gap-2 text-[11px] uppercase tracking-wider text-[#999] mb-2" style={{ gridTemplateColumns: `1.6fr ${cols.slice(1).map(() => '1fr').join(' ')}` }}>
        {cols.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 items-center px-2 py-2 rounded-lg hover:bg-[#faf9ff] text-[12px]" style={{ gridTemplateColumns: `1.6fr ${cols.slice(1).map(() => '1fr').join(' ')}` }}>
            {r.map((cell, j) => (
              <span key={j} className={j === 0 ? 'font-medium truncate' : 'text-[#777]'}>{cell}</span>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function MockBars({ values, labels }: { values: number[]; labels?: string[] }) {
  const max = Math.max(...values, 1);
  return (
    <Panel className="p-5">
      <div className="flex items-end gap-3 h-44">
        {values.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-2">
            <div className="w-full rounded-t-md" style={{ height: `${(v / max) * 100}%`, background: `linear-gradient(to top, ${ACCENT}, #FF8A5B)` }} />
            {labels && <span className="text-[10px] text-[#999]">{labels[i]}</span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function MockBoard({ columns }: { columns: { title: string; items: string[] }[] }) {
  return (
    <Panel className="p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {columns.map((c) => (
          <div key={c.title}>
            <div className="text-[11px] uppercase tracking-wider text-[#999] mb-2">{c.title}</div>
            <div className="space-y-2">
              {c.items.map((it) => (
                <div key={it} className="rounded-lg border border-[#eee] p-2 text-[12px]">{it}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function MockGrid({ count = 9, doodle = false }: { count?: number; doodle?: boolean }) {
  return (
    <Panel className="p-4">
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: count }, (_, i) =>
          doodle ? (
            <DoodleAvatar key={i} i={i} />
          ) : (
            <div key={i} className="aspect-square rounded-lg" style={{ background: `linear-gradient(135deg, hsl(${(i * 47) % 360} 60% 75%), hsl(${(i * 47 + 30) % 360} 60% 60%))` }} />
          ),
        )}
      </div>
    </Panel>
  );
}

// A simple hand-drawn-style avatar doodle (placeholder creative thumbnail).
export function DoodleAvatar({ i }: { i: number }) {
  const hue = (i * 53) % 360;
  const bg = `hsl(${hue} 70% 94%)`;
  const fg = `hsl(${hue} 55% 42%)`;
  const variant = i % 4;
  return (
    <div className="aspect-square rounded-xl grid place-items-center" style={{ background: bg }}>
      <svg viewBox="0 0 48 48" className="w-4/5 h-4/5" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* hair / hat by variant */}
        {variant === 0 && <path d="M15 17c1-6 17-6 18 0" />}
        {variant === 1 && <path d="M15 16q9-8 18 0" />}
        {variant === 2 && <path d="M16 16c0-5 16-5 16 0M16 16h16" />}
        {variant === 3 && <path d="M14 16h20l-2-4H16z" />}
        {/* head */}
        <circle cx="24" cy="20" r="8" />
        {/* eyes */}
        <circle cx="21" cy="19" r="0.6" fill={fg} />
        <circle cx="27" cy="19" r="0.6" fill={fg} />
        {/* mouth */}
        {variant % 2 === 0 ? <path d="M21 23q3 2.5 6 0" /> : <path d="M21.5 23h5" />}
        {/* shoulders */}
        <path d="M13 40c0-7 5-10 11-10s11 3 11 10" />
      </svg>
    </div>
  );
}

export function MockDoc({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <Panel className="p-6">
      <div className="text-[13px] font-semibold mb-4">{title}</div>
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-[13px] border-b border-[#f3f3f3] pb-2">
            <span className="text-[#777]">{k}</span>
            <span className="font-medium tabular-nums">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <span className="flex-1 text-center text-[12px] py-2 rounded-lg border border-[#eee]">Decline</span>
        <span className="flex-1 text-center text-[12px] py-2 rounded-lg text-white" style={{ background: ACCENT }}>Approve & Pay</span>
      </div>
    </Panel>
  );
}
