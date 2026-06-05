'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';

type Billing = 'monthly' | 'annual';

interface Plan {
  name: string;
  tagline: string;
  credits: string;
  price: number | null; // null = Custom
  cta: string;
  ctaHref: string;
  popular?: boolean;
  features: string[];
}

const PLANS: Plan[] = [
  {
    name: 'Free',
    tagline: 'Kick the tyres on real creator data.',
    credits: '100 credits (one-time)',
    price: 0,
    cta: 'Start free',
    ctaHref: '/lander',
    features: ['Marketplace campaign', 'Influencer database access', '1 brand', '1 team member', 'Basic support'],
  },
  {
    name: 'Startup',
    tagline: 'For small teams running their first campaigns.',
    credits: '6,999 credits / mo',
    price: 6999,
    cta: 'Get started',
    ctaHref: '/lander',
    features: ['Everything in Free', 'Basic analytics', 'Comment-to-DM (manual)', '3 brands', '3 team members', 'Priority support'],
  },
  {
    name: 'Growth',
    tagline: 'For brands scaling always-on influencer programs.',
    credits: '21,999 credits / mo',
    price: 19999,
    cta: 'Get started',
    ctaHref: '/lander',
    popular: true,
    features: ['Everything in Startup', 'Advanced analytics & insights', 'Competitor research (full)', 'AI search', '10 brands', '10 team members'],
  },
  {
    name: 'Enterprise',
    tagline: 'For agencies & large teams that need it all.',
    credits: 'Custom credits',
    price: null,
    cta: 'Contact us',
    ctaHref: '/lander',
    features: ['Everything in Growth', 'Discounted credits', 'API access', 'Comment-to-DM (automated)', 'Unlimited brands & seats', 'Dedicated manager'],
  },
];

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

function PriceLabel({ plan, billing }: { plan: Plan; billing: Billing }) {
  if (plan.price === null) return <div className="text-4xl font-bold tracking-tight">Custom</div>;
  if (plan.price === 0) return <div className="text-4xl font-bold tracking-tight">₹0<span className="text-[15px] font-medium text-ink-400"> /mo</span></div>;
  const perMonth = billing === 'annual' ? Math.round((plan.price * 10) / 12) : plan.price; // annual = 2 months free
  return (
    <div>
      <div className="text-4xl font-bold tracking-tight">{inr(perMonth)}<span className="text-[15px] font-medium text-ink-400"> /mo</span></div>
      {billing === 'annual' && <div className="text-[12px] text-emerald-600 font-medium mt-0.5">billed yearly · 2 months free</div>}
    </div>
  );
}

// 3D pointer-tilt plan card. Whichever card the cursor is over lifts, tilts and
// gets the accent highlight — no plan is permanently highlighted.
function PlanCard({ plan, billing }: { plan: Plan; billing: Billing }) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;  // -0.5 .. 0.5
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-py * 9).toFixed(2)}deg) rotateY(${(px * 11).toFixed(2)}deg) translateY(-10px) scale(1.035)`;
  }
  function onLeave() {
    if (ref.current) ref.current.style.transform = '';
  }

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="group relative rounded-3xl bg-white p-6 flex flex-col border border-border shadow-card hover:shadow-[0_28px_70px_rgba(108,77,246,0.22)] hover:border-[#6C4DF6] will-change-transform"
      style={{ transition: 'transform .15s ease-out, box-shadow .25s ease, border-color .25s ease', transformStyle: 'preserve-3d' }}
    >
      {plan.popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-semibold text-white shadow-sm" style={{ background: ACCENT }}>Most popular</span>
      )}
      <div className="text-[18px] font-bold text-ink-900">{plan.name}</div>
      <div className="text-[12px] text-ink-400 mt-0.5">{plan.credits}</div>
      <p className="text-[12.5px] text-ink-500 mt-2 leading-relaxed min-h-[34px]">{plan.tagline}</p>
      <div className="mt-4 min-h-[68px]"><PriceLabel plan={plan} billing={billing} /></div>
      <Link
        href={plan.ctaHref}
        className="mt-5 w-full text-center px-4 py-2.5 rounded-xl text-[14px] font-semibold border transition-colors text-white bg-ink-900 border-transparent group-hover:bg-ink-800"
      >
        {plan.cta}
      </Link>
      <div className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-ink-400">What you get</div>
      <ul className="mt-3 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-ink-700">
            <Check />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Comparison matrix. Cell value: true=✓, false=✗, string, or 'lock'.
type Cell = boolean | string;
const COMPARE: { group: string; icon: string; rows: { label: string; values: [Cell, Cell, Cell, Cell] }[] }[] = [
  {
    group: 'Campaign features', icon: 'list',
    rows: [
      { label: 'Marketplace campaign', values: ['100 credits', '100 credits', '100 credits', 'Custom'] },
      { label: 'In-house campaign', values: [false, false, '50 credits', 'Custom'] },
      { label: 'Add influencer to campaign', values: [false, true, true, true] },
      { label: 'Request price / counter offer', values: [false, '25 credits', '20 credits', 'Custom'] },
    ],
  },
  {
    group: 'Credit system', icon: 'coin',
    rows: [
      { label: 'Included credits', values: ['100 / mo', '6,999 / mo', '21,999 / mo', 'Custom'] },
      { label: 'Extra credit purchase', values: [false, true, true, true] },
      { label: 'Contact unlock cost', values: [false, '90 credits', '40 credits', 'Custom'] },
    ],
  },
  {
    group: 'Intelligence & analytics', icon: 'bars',
    rows: [
      { label: 'Influencer database access', values: ['Included', 'Included', 'Included', 'Included'] },
      { label: 'Influencer insights', values: ['lock', 'Basic', 'Advanced', 'Advanced'] },
      { label: 'AI search', values: [false, '5 credits / use', '5 credits / use', 'Custom'] },
      { label: 'Competitor research', values: [false, 'Limited · 400 cr', 'Full · 400 cr', 'Custom'] },
      { label: 'Report refresh', values: [false, '30 credits', '20 credits', 'Custom'] },
    ],
  },
  {
    group: 'Account limits', icon: 'building',
    rows: [
      { label: 'Brands allowed', values: ['1', '3', '10', 'Unlimited'] },
      { label: 'Team members', values: ['1', '3', '10', 'Unlimited'] },
    ],
  },
  {
    group: 'Advanced & support', icon: 'gear',
    rows: [
      { label: 'API access', values: [false, false, false, true] },
      { label: 'Comment to DM', values: [false, 'Manual', 'Optional add-on', 'Automated'] },
      { label: 'Support type', values: ['Basic', 'Priority', 'Premium', 'Dedicated manager'] },
    ],
  },
];

const FAQS = [
  { q: 'What are credits?', a: 'Credits are the universal currency across Influencer Intel. You spend them on actions like running campaigns, unlocking creator contacts, AI searches and report refreshes — so you only pay for what you actually use.' },
  { q: 'Do unused credits roll over?', a: 'Monthly plan credits reset each billing cycle. Credits you purchase as extra top-ups never expire and roll over for as long as your account is active.' },
  { q: 'Can I upgrade or downgrade anytime?', a: 'Yes. Upgrades apply instantly with a prorated charge, and downgrades take effect at the start of your next cycle. No lock-in.' },
  { q: 'What’s the difference between marketplace and in-house campaigns?', a: 'Marketplace campaigns let creators in our network apply to your brief. In-house campaigns let you invite and manage your own roster of creators directly — available on Growth and above.' },
  { q: 'Is there a success fee?', a: 'No hidden success fees. You pay your plan and credits — the outcomes (and creator payouts you set) are yours to keep.' },
];

export default function PricingPage() {
  const [billing, setBilling] = useState<Billing>('monthly');
  const [open, setOpen] = useState<number | null>(0);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="relative max-w-4xl mx-auto px-6 pt-16 pb-10 text-center">
            <span className="inline-block px-4 py-1.5 rounded-full bg-white border border-border shadow-sm text-[13px] font-semibold" style={{ color: ACCENT }}>Pricing</span>
            <h1 className="mt-6 text-4xl md:text-5xl font-bold tracking-tight text-ink-900 leading-[1.1]">
              Simple, transparent pricing for<br /><span style={{ color: ACCENT }}>influencer</span> growth
            </h1>
            <p className="mt-5 text-[17px] text-ink-600 max-w-xl mx-auto">Pay for outcomes, not tools. Scale campaigns with AI discovery and managed execution.</p>

            {/* Billing toggle */}
            <div className="mt-8 inline-flex items-center gap-1 p-1 rounded-full bg-[#f1f0f7] border border-border">
              {(['monthly', 'annual'] as Billing[]).map((b) => (
                <button
                  key={b}
                  onClick={() => setBilling(b)}
                  className={`px-4 py-1.5 rounded-full text-[13px] font-medium capitalize transition-colors ${billing === b ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}
                >
                  {b}{b === 'annual' && <span className="ml-1.5 text-[11px]" style={{ color: ACCENT }}>−17%</span>}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Plan cards */}
        <section className="max-w-6xl mx-auto px-6 pb-8 pt-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch" style={{ perspective: '1200px' }}>
            {PLANS.map((p) => (
              <PlanCard key={p.name} plan={p} billing={billing} />
            ))}
          </div>
        </section>

        {/* Compare all features */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-ink-900">Compare all features</h2>
            <p className="mt-2 text-[15px] text-ink-600">Hover a plan to see exactly what’s included.</p>
          </div>

          <div className="rounded-2xl border border-border overflow-hidden shadow-card" onMouseLeave={() => setHoveredCol(null)}>
            {/* header */}
            <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr] bg-[#f7f7fb] border-b border-border">
              <div className="px-5 py-4 text-[13px] font-semibold text-ink-700">Features</div>
              {PLANS.map((p, i) => (
                <div
                  key={p.name}
                  onMouseEnter={() => setHoveredCol(i)}
                  className="relative px-3 py-4 text-center text-[13px] font-semibold border-l border-border-soft cursor-default transition-colors"
                  style={hoveredCol === i ? { background: ACCENT_SOFT, color: ACCENT } : { color: '#333' }}
                >
                  {p.name}
                  {hoveredCol === i && <span className="absolute left-0 right-0 -bottom-px h-0.5" style={{ background: ACCENT }} />}
                </div>
              ))}
            </div>

            {COMPARE.map((sec) => (
              <div key={sec.group}>
                <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr] bg-[#fafafc] border-b border-border">
                  <div className="px-5 py-2.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-ink-500">
                    <span style={{ color: ACCENT }}><GroupIcon name={sec.icon} /></span>{sec.group}
                  </div>
                  {PLANS.map((p, i) => (
                    <div key={i} onMouseEnter={() => setHoveredCol(i)} className="border-l border-border-soft transition-colors" style={hoveredCol === i ? { background: ACCENT_SOFT } : undefined} />
                  ))}
                </div>
                {sec.rows.map((row) => (
                  <div key={row.label} className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr] border-b border-border-soft last:border-0">
                    <div className="px-5 py-3 text-[13.5px] text-ink-700">{row.label}</div>
                    {row.values.map((v, i) => (
                      <div
                        key={i}
                        onMouseEnter={() => setHoveredCol(i)}
                        className="px-3 py-3 grid place-items-center text-center text-[13px] border-l border-border-soft transition-colors"
                        style={hoveredCol === i ? { background: ACCENT_SOFT } : undefined}
                      >
                        <CellView v={v} highlight={hoveredCol === i} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-6 pb-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-ink-900">Frequently asked questions</h2>
            <p className="mt-2 text-[15px] text-ink-600">Everything you need to know about our pricing and credits.</p>
          </div>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <div key={f.q} className="rounded-xl bg-white border border-border overflow-hidden">
                <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left">
                  <span className="text-[15px] font-semibold text-ink-900">{f.q}</span>
                  <svg className={`w-4 h-4 shrink-0 text-ink-400 transition-transform ${open === i ? 'rotate-180' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
                </button>
                {open === i && <div className="px-5 pb-4 -mt-1 text-[14px] text-ink-600 leading-relaxed">{f.a}</div>}
              </div>
            ))}
          </div>
          <div className="text-center mt-8 text-[14px] text-ink-500">
            Still have questions? <a href="/lander" className="font-semibold" style={{ color: ACCENT }}>Contact support</a>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

function CellView({ v, highlight }: { v: Cell; highlight: boolean }) {
  if (v === true) return <Check />;
  if (v === false) return <Cross />;
  if (v === 'lock') return <Lock />;
  return <span className={highlight ? 'font-semibold' : 'text-ink-700'} style={highlight ? { color: ACCENT } : undefined}>{v}</span>;
}

function Check() {
  return (
    <span className="w-[18px] h-[18px] shrink-0 rounded-full grid place-items-center bg-emerald-500 text-white text-[11px]">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.5 3.5L13 5" /></svg>
    </span>
  );
}
function Cross() {
  return <span className="text-ink-300 text-[15px] leading-none">✕</span>;
}
function Lock() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0ad" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>);
}

function GroupIcon({ name }: { name: string }) {
  const c = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'list': return (<svg {...c}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>);
    case 'coin': return (<svg {...c}><circle cx="12" cy="12" r="9" /><path d="M9 9h4.5a2 2 0 0 1 0 4H9M9 9v6" /></svg>);
    case 'bars': return (<svg {...c}><path d="M6 20V10M12 20V4M18 20v-6" /></svg>);
    case 'building': return (<svg {...c}><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></svg>);
    case 'gear': return (<svg {...c}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 11h.1" /></svg>);
    default: return null;
  }
}
