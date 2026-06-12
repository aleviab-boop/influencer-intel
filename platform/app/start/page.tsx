'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

export default function StartPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.15), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.12), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
        <div className="grid-bg absolute inset-0 opacity-50" />
        <div className="relative max-w-5xl mx-auto px-6 pt-16 pb-20">
          <div className="text-center mb-12">
            <span className="inline-block px-3 py-1 rounded-full bg-white border border-border shadow-sm text-[12px] font-semibold" style={{ color: ACCENT }}>Get started</span>
            <h1 className="mt-5 text-4xl md:text-5xl font-bold tracking-tight text-ink-900">How will you use Influencer Intel?</h1>
            <p className="mt-4 text-[16px] text-ink-600 max-w-xl mx-auto">Pick your path — we’ll take you to the right place.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6" style={{ perspective: '1200px' }}>
            <PathCard
              tag="For Brands"
              title="Find creators & run campaigns"
              desc="Discover the right influencers with AI, recruit them into campaigns, track performance and pay them — all in one place."
              features={['AI creator discovery & scoring', 'Campaign pipeline & budgets', 'Competitor & authenticity intel', 'Payouts and analytics']}
              primary={{ label: 'Sign up as an agency', href: '/signup?role=agency' }}
              secondary={{ label: 'Log in', href: '/login?role=agency' }}
              icon="brand"
            />
            <PathCard
              tag="For Creators"
              title="Get paid brand deals"
              desc="Create your profile, get matched with brand campaigns that fit your niche, apply in a click and get paid on time."
              features={['Free to join — keep your rate', 'Get matched with real campaigns', 'Apply & track your deals', 'See your authenticity & ER']}
              primary={{ label: 'Sign up as a creator', href: '/signup?role=influencer' }}
              secondary={{ label: 'Log in', href: '/login?role=influencer' }}
              icon="creator"
            />
          </div>

          <p className="text-center mt-10 text-[13px] text-ink-400">Not sure? <Link href="/book-demo" className="font-semibold" style={{ color: ACCENT }}>Book a demo</Link> and we’ll point you the right way.</p>
        </div>
      </main>
    </div>
  );
}

function PathCard({ tag, title, desc, features, primary, secondary, icon }: {
  tag: string; title: string; desc: string; features: string[];
  primary: { label: string; href: string }; secondary: { label: string; href: string }; icon: 'brand' | 'creator';
}) {
  const ref = useRef<HTMLDivElement>(null);
  function onMove(e: React.MouseEvent) {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1000px) rotateX(${(-py * 6).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg) translateY(-6px)`;
  }
  function onLeave() { if (ref.current) ref.current.style.transform = ''; }

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="group rounded-3xl bg-white border border-border shadow-card hover:shadow-[0_28px_70px_rgba(108,77,246,0.2)] hover:border-[#6C4DF6] p-7 flex flex-col will-change-transform"
      style={{ transition: 'transform .15s ease-out, box-shadow .25s, border-color .25s' }}
    >
      <div className="w-12 h-12 rounded-2xl grid place-items-center mb-4" style={{ background: ACCENT_SOFT, color: ACCENT }}>
        {icon === 'brand'
          ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" /></svg>
          : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0" /></svg>}
      </div>
      <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>{tag}</div>
      <div className="text-[22px] font-bold text-ink-900 mt-1">{title}</div>
      <p className="mt-2 text-[14px] text-ink-600 leading-relaxed">{desc}</p>
      <ul className="mt-5 space-y-2.5 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-ink-700">
            <span className="w-[18px] h-[18px] mt-0.5 shrink-0 rounded-full grid place-items-center text-white text-[11px]" style={{ background: ACCENT }}>✓</span>
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex items-center gap-3">
        <Link href={primary.href} className="flex-1 text-center px-5 py-3 rounded-xl text-white text-[14px] font-semibold bg-ink-900 hover:bg-ink-800 transition-colors">{primary.label}</Link>
        <Link href={secondary.href} className="px-4 py-3 rounded-xl text-[14px] font-semibold border border-border hover:bg-[#faf9ff] transition-colors" style={{ color: ACCENT, borderColor: '#e3def9' }}>{secondary.label}</Link>
      </div>
    </div>
  );
}
