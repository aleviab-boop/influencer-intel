'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { DiscoverExperience } from '@/components/discover-experience';
import { Showcase } from '@/components/showcase';

// Reelax-style influencer-marketing landing page, themed for Influencer Intel
// with a violet accent. CTAs wire to the real app (/discover, /programs, …).
const ACCENT = '#6C4DF6';
const ACCENT_SOFT = '#F4F2FF';

const FEATURE_MENU: { label: string; href: string; icon: string }[] = [
  { label: 'Influencer Search', href: '/influencer-search', icon: 'search' },
  { label: 'Campaign Management', href: '/campaign-management', icon: 'list' },
  { label: 'Comment to DM', href: '/comment-to-dm', icon: 'chat' },
  { label: 'Competitor Analysis', href: '/competitor-analysis', icon: 'bars' },
  { label: 'Influencer Database', href: '/influencer-database', icon: 'database' },
  { label: 'Campaign Analytics', href: '/campaign-analytics', icon: 'clock' },
  { label: 'Media Management', href: '/media-management', icon: 'video' },
  { label: 'Influencer Payouts', href: '/influencer-payouts', icon: 'payout' },
];

function FeatureIcon({ name }: { name: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'search':
      return (<svg {...common}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>);
    case 'list':
      return (<svg {...common}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>);
    case 'chat':
      return (<svg {...common}><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /></svg>);
    case 'bars':
      return (<svg {...common}><path d="M6 20V10M12 20V4M18 20v-6" /></svg>);
    case 'database':
      return (<svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>);
    case 'clock':
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
    case 'video':
      return (<svg {...common}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>);
    case 'payout':
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9 8h6M9 11h6M14 8c0 3-2 4-5 4l4 4" /></svg>);
    case 'shield':
      return (<svg {...common}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>);
    case 'gauge':
      return (<svg {...common}><path d="M3.5 18a9 9 0 1 1 17 0" /><path d="M12 18l4.5-5.5" /></svg>);
    default:
      return null;
  }
}

export default function LanderPage() {
  const params = useSearchParams();
  const [query, setQuery] = useState<string | null>(params.get('prompt'));
  return (
    <div className="min-h-screen flex flex-col bg-white text-[#111] font-sans">
      <MarketingNav />
      <main className="flex-1 flex flex-col">
        {query !== null ? (
          // Searching from the home page runs inline — no redirect to another page.
          <DiscoverExperience initialPrompt={query} />
        ) : (
          <>
            <Hero onSearch={setQuery} />
            <LogoMarquee />
            <Showcase />
            <DatabaseSection />
            <FeatureGrid />
            <Testimonials />
            <StatsBand />
            <CaseStudies />
            <FAQ />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-[#eee]">
      <div className="w-full px-5 lg:px-10 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg grid place-items-center text-white text-sm font-bold" style={{ background: ACCENT }}>
            i
          </span>
          <span className="text-[15px] font-bold tracking-tight">Influencer Intel</span>
        </div>
        <nav className="hidden md:flex items-center gap-7 text-[14px] text-[#444]">
          <Link href="/lander" className="hover:text-[#111]">Home</Link>
          {/* Features — opens immediately on hover */}
          <div className="relative group h-16 flex items-center">
            <button className="flex items-center gap-1 group-hover:text-[var(--ii-accent)] transition-colors">
              Features
              <svg
                className="w-3.5 h-3.5 transition-transform group-hover:rotate-180"
                viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 w-[340px] z-50 opacity-0 invisible translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0">
              <div className="rounded-2xl bg-white border border-[#ececec] shadow-[0_16px_50px_rgba(0,0,0,0.12)] overflow-hidden">
                {FEATURE_MENU.map((f) => (
                  <Link
                    key={f.label}
                    href={f.href}
                    className="flex items-center gap-3.5 px-5 py-3.5 border-b border-[#f3f3f3] last:border-0 hover:bg-[#f6f4ff] transition-colors"
                  >
                    <span style={{ color: ACCENT }}><FeatureIcon name={f.icon} /></span>
                    <span className="text-[15px] font-medium text-[#222]">{f.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="relative group h-16 flex items-center">
            <button className="flex items-center gap-1 group-hover:text-[var(--ii-accent)] transition-colors">
              Services
              <svg className="w-3.5 h-3.5 transition-transform group-hover:rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
            </button>
            <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 w-[340px] z-50 opacity-0 invisible translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0">
              <div className="rounded-2xl bg-white border border-[#ececec] shadow-[0_16px_50px_rgba(0,0,0,0.12)] overflow-hidden">
                <Link href="/tools/fake-follower-checker" className="flex items-center gap-3.5 px-5 py-3.5 border-b border-[#f3f3f3] last:border-0 hover:bg-[#f6f4ff] transition-colors">
                  <span style={{ color: ACCENT }}><FeatureIcon name="shield" /></span>
                  <span className="text-[15px] font-medium text-[#222]">Authenticity Score</span>
                </Link>
                <Link href="/tools/er-calculator" className="flex items-center gap-3.5 px-5 py-3.5 border-b border-[#f3f3f3] last:border-0 hover:bg-[#f6f4ff] transition-colors">
                  <span style={{ color: ACCENT }}><FeatureIcon name="gauge" /></span>
                  <span className="text-[15px] font-medium text-[#222]">Engagement Rate (ER)</span>
                </Link>
              </div>
            </div>
          </div>
          <Link href="/pricing" className="hover:text-[#111]">Pricing</Link>
          <Link href="/for-influencers" className="hover:text-[#111]">For Influencers</Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-[14px] text-[#444] hover:text-[#111]">Log in</Link>
          <Link href="/start" className="text-[14px] font-medium hover:opacity-80" style={{ color: ACCENT }}>Sign up</Link>
          <Link
            href="/book-demo"
            className="px-4 py-2 rounded-lg text-white text-[14px] font-medium"
            style={{ background: ACCENT }}
          >
            Book a demo
          </Link>
        </div>
      </div>
    </header>
  );
}

const FILTER_CHIPS = [
  'AI creators', 'Micro influencer', 'UGC creators', 'Barter ready', 'Cricket lover',
  'Podcast', 'Beauty', 'Gym freak', 'Fashion', 'Trading', 'Education', 'Food blogger',
];

const SUGGESTIONS = [
  'Cricket and sports creators in Visakhapatnam for IPL season',
  'Summer Goa lookbook fashion creators',
  'Beauty micro-influencers in Mumbai with 85%+ credibility',
  'Festive Diwali ethnic-wear creators who post in Hindi',
  'Vegan food bloggers in Bangalore for a product launch',
];

// Typewriter: types each suggestion, holds, deletes, moves to the next.
function useTypewriter(words: string[]) {
  const [text, setText] = useState('');
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'deleting'>('typing');

  useEffect(() => {
    const word = words[i % words.length]!;
    let timer: ReturnType<typeof setTimeout>;
    if (phase === 'typing') {
      if (text.length < word.length) {
        timer = setTimeout(() => setText(word.slice(0, text.length + 1)), 45);
      } else {
        timer = setTimeout(() => setPhase('deleting'), 1600);
      }
    } else {
      if (text.length > 0) {
        timer = setTimeout(() => setText(word.slice(0, text.length - 1)), 22);
      } else {
        setPhase('typing');
        setI((v) => v + 1);
        timer = setTimeout(() => {}, 0);
      }
    }
    return () => clearTimeout(timer);
  }, [text, phase, i, words]);

  return text;
}

function Hero({ onSearch }: { onSearch: (q: string) => void }) {
  const [platform, setPlatform] = useState<'instagram' | 'youtube'>('instagram');
  const [value, setValue] = useState('');
  const typed = useTypewriter(SUGGESTIONS);

  const go = () => {
    const q = (value.trim() || typed || SUGGESTIONS[0]!).trim();
    onSearch(q);
  };

  return (
    <section className="relative overflow-hidden grid-bg">
      <div
        className="absolute inset-0 -z-10"
        style={{ background: `radial-gradient(820px 360px at 50% -8%, ${ACCENT_SOFT}, rgba(255,255,255,0))` }}
      />
      <div className="max-w-4xl mx-auto px-6 pt-16 pb-16 text-center">
        <span
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium mb-6 bg-white border border-[#ececff] shadow-sm"
          style={{ color: ACCENT }}
        >
          India’s AI-native InfluencerOS 🌐
        </span>
        <h1 className="text-4xl md:text-[54px] leading-[1.06] font-bold tracking-tight">
          The smart way to run<br />
          <span style={{ color: ACCENT }}>influencer campaigns</span>
        </h1>
        <p className="mt-5 text-[17px] text-[#555] max-w-2xl mx-auto">
          Get instant influencer-marketing impact — find creators, run campaigns, manage contracts,
          and handle payouts, all in one place.
        </p>

        {/* Animated search box */}
        <div className="mt-9 relative max-w-3xl mx-auto text-left">
          <div className="rounded-2xl bg-white border-2 transition-colors p-4 pb-16 shadow-[0_12px_50px_rgba(108,77,246,0.12)] focus-within:border-[#6C4DF6] border-[#e3def9]">
            <div className="relative">
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    go();
                  }
                }}
                rows={2}
                className="w-full resize-none text-[17px] text-[#222] placeholder-transparent focus:outline-none bg-transparent"
              />
              {value.length === 0 && (
                <div className="pointer-events-none absolute inset-0 text-[17px] text-[#9aa] select-none">
                  {typed}
                  <span className="ii-caret" style={{ color: ACCENT }}>|</span>
                </div>
              )}
            </div>

            {/* platform toggle bottom-left */}
            <div className="absolute left-4 bottom-4 inline-flex items-center gap-1 p-1 rounded-xl bg-[#f4f4f6]">
              {(['instagram', 'youtube'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`px-3 py-1.5 rounded-lg text-[13px] capitalize transition-colors ${
                    platform === p ? 'bg-white shadow-sm text-[#111] font-medium' : 'text-[#888]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* gradient circular search button bottom-right */}
            <button
              onClick={go}
              aria-label="Search"
              className="absolute right-4 bottom-4 w-12 h-12 rounded-full grid place-items-center text-white shadow-md hover:brightness-95"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-2xl mx-auto">
          {FILTER_CHIPS.map((c) => (
            <button
              key={c}
              onClick={() => onSearch(c)}
              className="px-3.5 py-1.5 rounded-full border border-[#dcd6f7] text-[13px] hover:bg-white bg-white/70"
              style={{ color: ACCENT }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// Brands for the two scrolling lines. `slug` maps to /public/logos/<slug>.png —
// drop those files in and they replace the text wordmark automatically.
const ROW_A = [
  { name: 'GUESS', slug: 'guess' },
  { name: 'Heineken', slug: 'heineken' },
  { name: 'H&M', slug: 'hm' },
  { name: 'L’ORÉAL', slug: 'loreal' },
  { name: 'LVMH', slug: 'lvmh' },
  { name: 'Marriott', slug: 'marriott' },
  { name: 'MICHELIN', slug: 'michelin' },
  { name: 'PHILIPS', slug: 'philips' },
  { name: 'SHISEIDO', slug: 'shiseido' },
  { name: 'Unilever', slug: 'unilever' },
];

const ROW_B = [
  { name: 'Nike', slug: 'nike' },
  { name: 'adidas', slug: 'adidas' },
  { name: 'Samsung', slug: 'samsung' },
  { name: 'Spotify', slug: 'spotify' },
  { name: 'Netflix', slug: 'netflix' },
  { name: 'SONY', slug: 'sony' },
  { name: 'NIVEA', slug: 'nivea' },
  { name: 'PUMA', slug: 'puma' },
  { name: 'ZARA', slug: 'zara' },
  { name: 'Mastercard', slug: 'mastercard' },
];

function LogoMarquee() {
  const rows = [
    { items: ROW_A, dir: 'ii-marquee-left' },
    { items: ROW_B, dir: 'ii-marquee-right' },
  ];
  return (
    <section className="relative overflow-hidden bg-white py-16 ii-marquee-pause">
      <h2 className="text-center text-2xl md:text-3xl font-bold tracking-tight mb-12">Trusted by 500+ brands</h2>

      <div className="space-y-10">
        {rows.map((row, ri) => (
          <div key={ri} className="flex overflow-hidden">
            <div className={`flex items-center gap-20 pr-20 ${row.dir}`} style={{ width: 'max-content' }}>
              {[...row.items, ...row.items].map((b, i) => (
                <LogoItem key={`${b.slug}-${i}`} name={b.name} slug={b.slug} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-32 z-10 bg-gradient-to-r from-white to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-32 z-10 bg-gradient-to-l from-white to-transparent" />
    </section>
  );
}

function LogoItem({ name, slug }: { name: string; slug: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <span className="text-[26px] font-semibold tracking-tight text-[#bcbcbc] whitespace-nowrap select-none">
        {name}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/logos/${slug}.png`}
      alt={name}
      onError={() => setErr(true)}
      className="h-6 md:h-7 w-auto object-contain hover:scale-105 transition select-none"
    />
  );
}

const SAMPLE_CREATORS = [
  { name: 'Aisha Kapoor', city: 'Mumbai', followers: '248K', er: '4.8%', match: 96 },
  { name: 'Rohan Mehta', city: 'Delhi', followers: '512K', er: '3.1%', match: 92 },
  { name: 'Neha Sharma', city: 'Bangalore', followers: '89K', er: '6.2%', match: 90 },
  { name: 'Arjun Rao', city: 'Hyderabad', followers: '1.2M', er: '2.4%', match: 88 },
];
const DB_LOCATIONS = ['MUM', 'DL', 'BLR', 'HYD', 'CHN', 'KOL', 'PUN', 'JAI', 'AHM', 'LKO'];

function DatabaseSection() {
  const [total, setTotal] = useState<string>('2.4M+');
  useEffect(() => {
    fetch('/api/creators?limit=1')
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.total === 'number' && d.total > 0) setTotal(d.total.toLocaleString());
      })
      .catch(() => {});
  }, []);

  return (
    <section id="database" className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>The largest influencer database</span>
          <h2 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">
            {total} creators, indexed and scored
          </h2>
          <p className="mt-4 text-[16px] text-[#555]">
            Search across India with 12+ data metrics, 14+ categories and 10+ languages. Every
            creator is credibility-scored with live engagement data and an AI match to your brief.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {DB_LOCATIONS.map((l) => (
              <span key={l} className="px-2.5 py-1 rounded-md text-[12px] font-medium bg-[#f5f5f5] text-[#666]">{l}</span>
            ))}
          </div>
          <Link href="/lander" className="mt-7 inline-block px-5 py-2.5 rounded-lg text-white text-[14px] font-medium" style={{ background: ACCENT }}>
            Explore the database
          </Link>
        </div>

        <div className="rounded-2xl border border-[#eaeaea] bg-white shadow-[0_8px_40px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0f0f0] flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: ACCENT }} />
            <span className="text-[13px] text-[#666]">Live search · summer Goa lookbook</span>
            <span className="ml-auto text-[11px] text-[#aaa]">updated just now</span>
          </div>
          <div className="divide-y divide-[#f3f3f3]">
            {SAMPLE_CREATORS.map((c) => (
              <div key={c.name} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={c.name} />
                <div className="min-w-0">
                  <div className="text-[14px] font-medium truncate">{c.name}</div>
                  <div className="text-[12px] text-[#999]">{c.city} · {c.followers} · {c.er} ER</div>
                </div>
                <span
                  className="ml-auto text-[13px] font-semibold tabular-nums px-2 py-0.5 rounded-md"
                  style={{ background: ACCENT_SOFT, color: ACCENT }}
                >
                  {c.match}% match
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { t: 'Campaign Management', d: 'Automate outreach, approvals, and recruitment pipelines end-to-end.', href: '/campaign-management' },
  { t: 'Influencer Discovery', d: 'Type a brief in plain English, get a credibility-scored shortlist in minutes.', href: '/influencer-search' },
  { t: 'AI Campaign Intelligence', d: 'Auto-generate content briefs and reel concepts tailored to each creator.', href: '/monitor' },
  { t: 'AI Analytics Dashboard', d: 'Predicted vs. real likes & views, with confidence and trend signals.', href: '/monitor' },
  { t: 'Competitor Analysis', d: 'Track creator overlaps and share of voice against your competitors.', href: '#' },
  { t: 'Comment to DM', d: 'Turn comments into personalized conversations, automatically.', href: '#' },
  { t: 'Contracts & Payments', d: 'Streamlined agreements and creator payouts in one flow.', href: '#' },
  { t: 'Quality & Fraud', d: 'Fake-follower detection and a 0–100 quality gate on every creator.', href: '/influencer-search' },
];

function FeatureGrid() {
  return (
    <section id="features" className="py-20" style={{ background: ACCENT_SOFT }}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>Everything in one place</span>
          <h2 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Quality content at scale</h2>
          <p className="mt-3 text-[16px] text-[#555]">
            One platform to discover, recruit, brief, run, and measure — the full influencer lifecycle.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <Link
              key={f.t}
              href={f.href}
              className="group p-5 rounded-2xl bg-white border border-[#ececff] hover:shadow-[0_8px_30px_rgba(108,77,246,0.12)] transition-shadow"
            >
              <div className="w-10 h-10 rounded-xl grid place-items-center mb-4 text-white" style={{ background: ACCENT }}>
                <span className="text-[16px] font-bold">{f.t.charAt(0)}</span>
              </div>
              <h3 className="text-[15px] font-semibold mb-1.5">{f.t}</h3>
              <p className="text-[13px] text-[#666] leading-relaxed">{f.d}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

const TESTIMONIALS = [
  { q: 'Campaign Manager automation saved us time and resources, so we focus on strategy.', n: 'Gaurav Khare', r: 'Malabar Gold' },
  { q: 'During campaign execution we got great support from the campaign managers.', n: 'Gagan Gulati', r: 'Chatwise' },
  { q: 'Makes collaboration easy — find the right influencers and manage campaigns efficiently.', n: 'Kajal', r: 'Wellfa' },
  { q: 'A very good platform for both influencers and businesses. Finding the right fit is finally simple.', n: 'Vinay', r: 'Moda Veda' },
  { q: 'Saved us the huge amount of time we used to spend on influencer marketing manually.', n: 'Alok', r: 'Educase.io' },
];

function Testimonials() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>Our users love us</span>
          <h2 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Trusted by modern brands</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {TESTIMONIALS.slice(0, 3).map((t) => (
            <Card key={t.n} t={t} />
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-4 mt-4 md:max-w-3xl md:mx-auto">
          {TESTIMONIALS.slice(3).map((t) => (
            <Card key={t.n} t={t} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({ t }: { t: { q: string; n: string; r: string } }) {
  return (
    <div className="p-6 rounded-2xl bg-[#fafafa] border border-[#f0f0f0]">
      <div className="text-[22px] leading-none mb-3" style={{ color: ACCENT }}>“</div>
      <p className="text-[14px] text-[#333] leading-relaxed">{t.q}</p>
      <div className="mt-4 flex items-center gap-2.5">
        <Avatar name={t.n} />
        <div>
          <div className="text-[13px] font-semibold">{t.n}</div>
          <div className="text-[12px] text-[#999]">{t.r}</div>
        </div>
      </div>
    </div>
  );
}

function StatsBand() {
  const stats = [
    { k: '2.4M+', v: 'Creators indexed' },
    { k: '14+', v: 'Categories' },
    { k: '10+', v: 'Indian languages' },
    { k: '12+', v: 'Data metrics' },
  ];
  return (
    <section id="tools" className="py-16" style={{ background: '#111' }}>
      <div className="max-w-6xl mx-auto px-6 text-center text-white">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Data-driven influencer marketing</h2>
        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((s) => (
            <div key={s.v}>
              <div className="text-3xl md:text-4xl font-bold" style={{ color: '#b9a8ff' }}>{s.k}</div>
              <div className="mt-1 text-[13px] text-[#aaa]">{s.v}</div>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <span className="px-4 py-2 rounded-lg bg-white/10 text-[14px]">Authenticity Score</span>
          <span className="px-4 py-2 rounded-lg bg-white/10 text-[14px]">Engagement Rate Calculator</span>
        </div>
      </div>
    </section>
  );
}

const CASES = [
  { brand: 'Bajaj', slug: 'bajaj', metric: '3.2x', label: 'engagement uplift', tag: 'Auto' },
  { brand: 'Wellfa', slug: 'welfa', metric: '120+', label: 'creators activated', tag: 'Wellness' },
  { brand: 'Triumph', slug: 'triumph', metric: '48hrs', label: 'campaign turnaround', tag: 'Fashion' },
];

function CaseStudies() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>Client success stories</span>
          <h2 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Real results, real brands</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {CASES.map((c) => (
            <div key={c.brand} className="rounded-2xl border border-[#eee] overflow-hidden">
              <div className="h-36 grid place-items-center bg-white px-8">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/logos/${c.slug}.png`} alt={c.brand} className="max-h-12 w-auto object-contain" />
              </div>
              <div className="p-5">
                <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-md" style={{ background: ACCENT_SOFT, color: ACCENT }}>{c.tag}</span>
                <div className="mt-3 text-3xl font-bold">{c.metric}</div>
                <div className="text-[13px] text-[#777]">{c.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  { q: 'What is Influencer Intel?', a: 'An AI-native influencer marketing platform to discover creators, run campaigns, and measure results across Instagram and YouTube.' },
  { q: 'How does discovery work?', a: 'Type a campaign brief in plain English. We parse it, search a scored creator database, and return a recruit-ready shortlist with relevance, confidence and quality scores.' },
  { q: 'How many influencers are in the database?', a: 'Hundreds of thousands of Indian creators, continuously indexed and credibility-scored.' },
  { q: 'Can I manage full campaigns?', a: 'Yes — recruit creators into programs, move them through a status pipeline, brief content, and track predicted vs. real performance.' },
  { q: 'Do you offer UGC?', a: 'Yes, you can filter for UGC creators and barter-ready influencers during discovery.' },
  { q: 'How do you ensure influencer quality?', a: 'Every creator gets a 0–100 quality score from followers, engagement and per-post likes/comments, plus fake-follower detection.' },
  { q: 'How is pricing structured?', a: 'Standard and Pro plans — Pro unlocks higher limits and advanced analytics. Book a demo for details.' },
  { q: 'How do I get started?', a: 'Click “Start discovering”, enter a brief, and you’ll see a scored shortlist in minutes.' },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="py-20" style={{ background: ACCENT_SOFT }}>
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-10">Frequently asked questions</h2>
        <div className="space-y-2">
          {FAQS.map((f, i) => (
            <div key={f.q} className="rounded-xl bg-white border border-[#ececff]">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left"
              >
                <span className="text-[15px] font-medium">{f.q}</span>
                <span className="text-[20px] leading-none" style={{ color: ACCENT }}>{open === i ? '−' : '+'}</span>
              </button>
              {open === i && <p className="px-5 pb-4 text-[14px] text-[#555] leading-relaxed">{f.a}</p>}
            </div>
          ))}
        </div>

        <div className="mt-12 text-center rounded-2xl bg-white border border-[#ececff] p-10">
          <h3 className="text-2xl font-bold tracking-tight">Ready to run smarter campaigns?</h3>
          <p className="mt-2 text-[15px] text-[#555]">Start discovering creators in under five minutes.</p>
          <Link href="/lander" className="mt-6 inline-block px-6 py-3 rounded-xl text-white text-[15px] font-medium" style={{ background: ACCENT }}>
            Start discovering →
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const cols = [
    { h: 'Product', links: ['Influencer Database', 'Campaign Management', 'Comment to DM', 'Competitor Analysis', 'Search', 'Payouts'] },
    { h: 'Resources', links: ['Authenticity Score', 'ER Calculator', 'Influencer directories', 'Case studies'] },
    { h: 'About', links: ['Team', 'Contact', 'Privacy Policy', 'Terms'] },
  ];
  return (
    <footer className="bg-[#0c0c0c] text-[#bbb] pt-14 pb-8">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg grid place-items-center text-white text-sm font-bold" style={{ background: ACCENT }}>i</span>
            <span className="text-[15px] font-bold text-white">Influencer Intel</span>
          </div>
          <p className="text-[13px] text-[#777] leading-relaxed">India’s AI-native InfluencerOS for brands.</p>
        </div>
        {cols.map((c) => (
          <div key={c.h}>
            <div className="text-[13px] font-semibold text-white mb-3">{c.h}</div>
            <ul className="space-y-2 text-[13px]">
              {c.links.map((l) => (
                <li key={l}><a href="#" className="hover:text-white">{l}</a></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="max-w-6xl mx-auto px-6 mt-12 pt-6 border-t border-[#222] flex items-center justify-between text-[12px] text-[#666]">
        <span>© 2026 Influencer Intel</span>
        <span className="flex gap-4"><a href="#" className="hover:text-white">Instagram</a><a href="#" className="hover:text-white">LinkedIn</a></span>
      </div>
    </footer>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return (
    <div
      className="w-9 h-9 rounded-full grid place-items-center text-white text-[12px] font-semibold shrink-0"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))` }}
    >
      {initials}
    </div>
  );
}
