'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ACCENT, ACCENT_SOFT } from './marketing';

interface Item {
  icon: React.ReactNode;
  title: string;
  desc: string;
  mock: React.ReactNode;
}

// A distinct accent colour per feature, so the list is colourful.
const FEATURE_COLORS = ['#6C4DF6', '#ec4899', '#10b981', '#f59e0b'];

export function Showcase() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const items: Item[] = [
    { icon: <IconDb />, title: 'Largest Influencer Database', desc: 'India’s largest verified creator network — AI-powered filters, deep insights and smart discovery across Instagram & YouTube.', mock: <DatabaseMock /> },
    { icon: <IconList />, title: 'Campaign Management', desc: 'Automate and manage high-volume creator campaigns — from outreach to approvals — in one dashboard.', mock: <CampaignMock /> },
    { icon: <IconBars />, title: 'Competitor Analysis', desc: 'Uncover competitors’ creators, share of voice and influencer overlaps — benchmarked by size, category and location.', mock: <CompetitorMock /> },
    { icon: <IconSpark />, title: 'AI-Powered Campaign Intelligence', desc: 'Find creators faster, generate scripts instantly and craft winning briefs — let AI do the work while you focus on results.', mock: <AIMock /> },
  ];
  const N = items.length;

  useEffect(() => {
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      setActive(Math.min(N - 1, Math.floor(p * N + 0.0001)));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [N]);

  const jumpTo = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const total = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: el.offsetTop + (i / N) * total + total / (N * 2), behavior: 'smooth' });
  };

  return (
    <section ref={ref} className="relative" style={{ height: `${N * 80}vh`, background: '#eef1ff' }}>
      <div className="sticky top-0 h-screen flex flex-col justify-center overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 w-full">
          <div className="text-center max-w-3xl mx-auto mb-8">
            <h2 className="text-3xl md:text-[40px] font-bold tracking-tight leading-tight text-[#1a1a3a]">
              India’s influencer marketing platform — find creators, run campaigns, pay creators
            </h2>
            <p className="mt-3 text-[16px] text-[#555]">
              A unified AI-powered platform to discover creators, automate engagement, analyze competitors and scale campaigns faster.
            </p>
          </div>

          <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-6 items-center">
            {/* left: feature list */}
            <div className="space-y-3">
              {items.map((it, i) => {
                const on = i === active;
                const c = FEATURE_COLORS[i % FEATURE_COLORS.length]!;
                return (
                  <button
                    key={it.title}
                    onClick={() => jumpTo(i)}
                    className="w-full text-left rounded-2xl p-4 flex gap-4 transition-all duration-300 border hover:opacity-100"
                    style={{
                      background: on ? 'white' : 'rgba(255,255,255,0.5)',
                      borderColor: on ? c : 'transparent',
                      boxShadow: on ? `0 14px 44px ${c}33` : 'none',
                      opacity: on ? 1 : 0.7,
                    }}
                  >
                    <span
                      className="w-11 h-11 rounded-xl grid place-items-center shrink-0 transition-all duration-300"
                      style={{
                        background: on ? `linear-gradient(135deg, ${c}, ${c}cc)` : `${c}1f`,
                        color: on ? 'white' : c,
                        boxShadow: on ? `0 6px 18px ${c}55` : 'none',
                        transform: on ? 'scale(1.06)' : 'scale(1)',
                      }}
                    >
                      {it.icon}
                    </span>
                    <span>
                      <span className="block font-semibold text-[#1a1a3a]">{it.title}</span>
                      <span className="block text-[13px] text-[#666] leading-relaxed mt-0.5">{it.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* right: animated mock for the active feature */}
            <div className="relative min-h-[420px]">
              <div key={active} className="ii-fadeup">
                {items[active]!.mock}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- shared bits --------------------------------------------------------

function Glass({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl bg-white/80 backdrop-blur border border-white shadow-[0_20px_60px_rgba(60,60,120,0.12)] p-4 ${className}`}>
      {children}
    </div>
  );
}

function bar(w: string, delay = 0, grad = `linear-gradient(90deg, ${ACCENT}, #9b7bff)`): { className: string; style: CSSProperties } {
  return {
    className: 'ii-bar h-2.5 rounded-full',
    style: { ['--w' as string]: w, width: w, background: grad, boxShadow: `0 0 14px rgba(108,77,246,0.55)`, animationDelay: `${delay}s` } as CSSProperties,
  };
}

// ---- mock 1: database ---------------------------------------------------

// Pins at approximate Indian city positions, in the accurate map's coordinate
// space (viewBox 0 0 612 696 — matches /public/india.svg).
const PINS: { x: number; y: number; label?: string }[] = [
  { x: 250, y: 215, label: 'Delhi' },
  { x: 178, y: 432, label: 'Mumbai' },
  { x: 258, y: 548, label: 'Bengaluru' },
  { x: 282, y: 472, label: 'Hyderabad' },
  { x: 305, y: 548, label: 'Chennai' },
  { x: 418, y: 352, label: 'Kolkata' },
  { x: 212, y: 248 },
  { x: 166, y: 352 },
  { x: 198, y: 458 },
  { x: 202, y: 512 },
  { x: 312, y: 278 },
];

// Vibrant per-pin colours so the map dots pop.
const PIN_COLORS = ['#6C4DF6', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#ef4444', '#8b5cf6', '#14b8a6'];

function IndiaMap() {
  return (
    <div className="relative w-full grid place-items-center">
      <div className="relative w-full max-w-[270px]">
        {/* accurate India map (states), recoloured to the violet theme */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/india.svg" alt="Map of India" className="w-full h-auto select-none" draggable={false} />
        {/* animated creator pins, same viewBox so coordinates align */}
        <svg viewBox="0 0 612 696" className="absolute inset-0 w-full h-full pointer-events-none">
          {PINS.map((p, i) => {
            const c = PIN_COLORS[i % PIN_COLORS.length]!;
            return (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="22" fill={c} opacity="0.18" className="ii-pulse" style={{ transformBox: 'fill-box', transformOrigin: 'center', animationDelay: `${i * 0.22}s` } as CSSProperties} />
                <circle cx={p.x} cy={p.y} r="8" fill={c} />
                <circle cx={p.x - 2.2} cy={p.y - 2.2} r="2.6" fill="white" opacity="0.85" />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="absolute bottom-0 text-[10px] text-[#999]">Creators across India</div>
    </div>
  );
}

function DatabaseMock() {
  return (
    <Glass>
      <div className="flex items-center gap-2 rounded-2xl border border-[#e9e9f5] bg-white px-3 py-2.5 mb-3">
        <span className="w-8 h-8 rounded-full grid place-items-center text-white text-[13px]" style={{ background: ACCENT }}>🔍</span>
        <span className="text-[14px] text-[#333]">travel creators · 100k+ followers · India</span>
        <span className="ml-auto text-[11px] px-2 py-1 rounded-full text-white" style={{ background: ACCENT }}>✦ AI</span>
      </div>
      <div className="flex items-center gap-2 mb-4 text-[12px]">
        <span className="px-2.5 py-1 rounded-full text-white" style={{ background: ACCENT }}>All</span>
        <span className="px-2.5 py-1 rounded-full bg-[#f2f2fb] text-[#888]">Instagram</span>
        <span className="px-2.5 py-1 rounded-full bg-[#f2f2fb] text-[#888]">YouTube</span>
        <span className="ml-auto text-[12px] text-[#888]">2.4M creators</span>
      </div>

      <div className="grid grid-cols-[0.8fr_1.2fr_1fr] gap-3">
        {/* filters */}
        <div className="rounded-2xl border border-[#eee] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-[#aaa] mb-2">Filters</div>
          {[['Niche', 'Travel'], ['Reach', '100K+'], ['Eng.', '>4%'], ['Region', 'India'], ['Verified', 'Yes']].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-[#eee] px-2 py-1.5 mb-1.5">
              <div className="text-[9px] text-[#aaa]">{k}</div>
              <div className="text-[12px] font-semibold">{v}</div>
            </div>
          ))}
        </div>

        {/* India map with creator pins */}
        <IndiaMap />

        {/* creator card */}
        <div className="rounded-2xl border border-[#eee] p-3 self-start" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, white)` }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold" style={{ background: ACCENT }}>K</div>
            <div>
              <div className="text-[12px] font-semibold">@Kaushal P.</div>
              <div className="text-[10px] text-[#999]">Travel · Luxury</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="rounded-lg bg-white border border-[#eee] p-1.5"><div className="text-[9px] text-[#aaa]">Followers</div><div className="text-[12px] font-bold">7.5M</div></div>
            <div className="rounded-lg bg-white border border-[#eee] p-1.5"><div className="text-[9px] text-[#aaa]">Engage</div><div className="text-[12px] font-bold">1.6%</div></div>
          </div>
          <div className="text-[10px] text-[#888] mb-1 flex justify-between"><span>AI match</span><span className="font-bold" style={{ color: ACCENT }}>94%</span></div>
          <div className="h-2 rounded-full bg-[#eef]"><div {...bar('94%')} /></div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-[11px] text-[#888]">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live</span>
        <span>4 Lac data</span>
        <span style={{ color: ACCENT }}>⚡ 23k+ new today</span>
      </div>
    </Glass>
  );
}

// ---- mock 2: campaign management ---------------------------------------

const CAMPAIGNS = [
  { n: 'Summer Drop', w: '92%', s: 'Live', c: 'emerald' },
  { n: 'Holiday Push', w: '74%', s: 'Active', c: 'violet' },
  { n: 'Brand Reveal', w: '48%', s: 'Draft', c: 'gray' },
  { n: 'Q4 Launch', w: '63%', s: 'Final', c: 'green' },
];

function CampaignMock() {
  return (
    <Glass>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[['Active', '12'], ['Reach', '2.4M'], ['ROI', '312%']].map(([k, v], i) => (
          <div key={k} className="rounded-2xl border border-[#eee] p-3 ii-countup" style={{ animationDelay: `${i * 0.1}s` }}>
            <div className="text-[10px] uppercase tracking-wider text-[#aaa]">{k}</div>
            <div className="text-2xl font-bold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="space-y-4">
        {CAMPAIGNS.map((c, i) => (
          <div key={c.n}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[13px] font-semibold">{c.n}</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full" style={pill(c.c)}>{c.s}</span>
            </div>
            <div className="h-2.5 rounded-full bg-[#e9e9f6] overflow-hidden">
              <div {...bar(c.w, i * 0.12, gradFor(c.c))} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <span className="px-3 py-1.5 rounded-full text-[12px] bg-white border border-[#eee] shadow-sm" style={{ color: ACCENT }}>✦ Boost reach +18%</span>
      </div>
    </Glass>
  );
}

function gradFor(c: string): string {
  if (c === 'emerald') return 'linear-gradient(90deg, #10b981, #6C4DF6)';
  if (c === 'green') return 'linear-gradient(90deg, #34d399, #6C4DF6)';
  if (c === 'gray') return 'linear-gradient(90deg, #c4c4d6, #9b8bff)';
  return `linear-gradient(90deg, ${ACCENT}, #9b7bff)`;
}
function pill(c: string): CSSProperties {
  const map: Record<string, [string, string]> = {
    emerald: ['#065f46', '#d1fae5'], violet: ['#5b21b6', '#ede9fe'], gray: ['#6b7280', '#f3f4f6'], green: ['#166534', '#dcfce7'],
  };
  const [fg, bg] = map[c] ?? map.violet!;
  return { color: fg, background: bg };
}

// ---- mock 3: competitor analysis ---------------------------------------

function CompetitorMock() {
  const sov = [['You', '46%'], ['Comp A', '27%'], ['Comp B', '17%'], ['Comp C', '10%']] as const;
  const grads = [
    'linear-gradient(90deg,#6C4DF6,#9b7bff)',
    'linear-gradient(90deg,#ec4899,#f472b6)',
    'linear-gradient(90deg,#f59e0b,#fbbf24)',
    'linear-gradient(90deg,#10b981,#34d399)',
  ];
  const stats: [string, string, string][] = [
    ['Overlaps', '318', '#6C4DF6'],
    ['Exclusive wins', '46', '#ec4899'],
    ['Tracked', '4,782', '#10b981'],
  ];
  return (
    <Glass>
      <div className="text-[13px] font-semibold mb-1">Share of voice</div>
      <div className="text-[11px] text-[#999] mb-4">Creator mentions vs competitors · last 30 days</div>
      <div className="space-y-4 mb-6">
        {sov.map(([k, v], i) => (
          <div key={k}>
            <div className="flex justify-between text-[12px] mb-1"><span className="font-medium">{k}</span><span className="font-semibold" style={{ color: grads[i] ? FEATURE_COLORS[i] : '#888' }}>{v}</span></div>
            <div className="h-2.5 rounded-full bg-[#e9e9f6] overflow-hidden">
              <div {...bar(v, i * 0.12, grads[i % grads.length])} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {stats.map(([k, v, c], i) => (
          <div key={k} className="rounded-xl border p-2.5 ii-countup" style={{ animationDelay: `${i * 0.1}s`, borderColor: `${c}33`, background: `${c}0d` }}>
            <div className="text-lg font-bold tabular-nums" style={{ color: c }}>{v}</div>
            <div className="text-[10px] text-[#999]">{k}</div>
          </div>
        ))}
      </div>
    </Glass>
  );
}

// ---- mock 4: AI campaign intelligence ----------------------------------

function AIMock() {
  return (
    <Glass>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 rounded-lg grid place-items-center text-white" style={{ background: ACCENT }}>✦</span>
        <span className="text-[13px] font-semibold">AI brief generator</span>
      </div>
      <div className="rounded-2xl border border-[#eee] p-3 mb-3 bg-[#faf9ff]">
        <div className="text-[11px] text-[#999] mb-1">Prompt</div>
        <div className="text-[13px]">Festive Diwali reel for a ghee skincare line, metro women 25–34</div>
      </div>
      <div className="space-y-2">
        {['Hook: “3 things nobody tells you about festive skin…”', 'Format: 15s reel · trending audio', 'CTA: comment “GLOW” for the routine', 'Best window: Thu 7–9pm'].map((l, i) => (
          <div key={l} className="flex items-center gap-2 rounded-xl border border-[#eee] bg-white px-3 py-2 text-[12px] ii-countup" style={{ animationDelay: `${0.15 + i * 0.15}s` }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT }} />
            {l}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] text-[#999]">Generated in 1.2s</span>
        <span className="px-3 py-1.5 rounded-full text-[12px] text-white" style={{ background: ACCENT }}>Use brief →</span>
      </div>
    </Glass>
  );
}

// ---- icons --------------------------------------------------------------

const ic = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const IconDb = () => (<svg {...ic}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>);
const IconList = () => (<svg {...ic}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>);
const IconBars = () => (<svg {...ic}><path d="M6 20V10M12 20V4M18 20v-6" /></svg>);
const IconSpark = () => (<svg {...ic}><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z" /></svg>);
