'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';

export default function InfluencerSearchPage() {
  return (
    <div className="min-h-screen bg-white text-[#111] font-sans">
      <MarketingNav />
      <Hero />
      <FeatureRow
        flip
        title="One of the best influencer search tools for Instagram and Youtube"
        body="Unlock unparalleled influencer-marketing opportunities with our advanced search. Effortlessly search through millions of influencers in any location or category on Instagram and YouTube to find the perfect match for your brand. Precise filters and an extensive database ensure you connect with creators who truly resonate with your audience."
        mock={<ProfileMock />}
      />
      <FeatureRow
        title="Precision Filters for Your Needs"
        body="Filter influencers that match your brand in seconds. Identify the right creators with filters across category, niche, location, engagement, followers and more — combined on the creator’s traits, media variables and audience information."
        mock={<FiltersMock />}
      />
      <FeatureRow
        flip
        title="Uncover Influencer Collaborations"
        body="See who’s collaborating with whom in your niche with our mentions filter. Identify the perfect partners for your influencer-marketing campaigns and build curated lists in a click."
        mock={<CollabMock />}
      />
      <FAQ />
      <MarketingFooter />
    </div>
  );
}

function Hero() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('prompt') ?? '');
  const go = () => router.push(`/lander?prompt=${encodeURIComponent(q.trim() || 'fashion influencers in Mumbai')}`);

  return (
    <section className="grid-bg">
      <div className="max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.08]">
            Search Indian Instagram and Youtube influencers
          </h1>
          <p className="mt-5 text-[17px] text-[#555] max-w-xl">
            Search among 2.5 lakh+ creators. Apply accurate filters to discover the right
            influencers for your brand across different social networks.
          </p>
          <div className="mt-7 flex items-center gap-2 max-w-md">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              placeholder="Find influencers to collaborate with"
              className="flex-1 px-4 py-3 border border-border bg-white text-[15px] rounded-lg focus:outline-none focus:border-[#F2542D]"
            />
            <button onClick={go} className="px-5 py-3 rounded-lg text-white text-[14px] font-medium" style={{ background: ACCENT }}>
              Get Started →
            </button>
          </div>
        </div>
        <SuggestedMock />
      </div>
    </section>
  );
}

function FeatureRow({ title, body, mock, flip }: { title: string; body: string; mock: React.ReactNode; flip?: boolean }) {
  return (
    <section className="border-t border-[#f0f0f0]">
      <div className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
        <div className={flip ? 'lg:order-2' : ''}>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">{title}</h2>
          <p className="mt-4 text-[16px] text-[#555] leading-relaxed">{body}</p>
          <Link href="/lander" className="mt-6 inline-flex items-center gap-1 text-[15px] font-medium" style={{ color: ACCENT }}>
            Get Started →
          </Link>
        </div>
        <div className={flip ? 'lg:order-1' : ''}>{mock}</div>
      </div>
    </section>
  );
}

// ---- product mockups (presentational) ----------------------------------

const CREATORS = [
  { name: 'Kuldeep Singhania', city: 'Jaipur', f: '3.7M', v: '4.4M', er: '8.6%', m: 96 },
  { name: 'Amrit Ramgharia', city: 'Amritsar', f: '2.6M', v: '158.7K', er: '1.2%', m: 92 },
  { name: 'Vyankatesh Patel', city: 'Ahmedabad', f: '2.3M', v: '202.6K', er: '0.7%', m: 90 },
  { name: 'Bhumika', city: 'Chandigarh', f: '2.1M', v: '32.5K', er: '1.1%', m: 88 },
];

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white border border-[#eaeaea] shadow-[0_12px_50px_rgba(0,0,0,0.08)] ${className}`}>
      {children}
    </div>
  );
}

function SuggestedMock() {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold">Suggested Influencers
          <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded text-white" style={{ background: ACCENT }}>AI</span>
        </span>
        <span className="text-[11px] text-[#999]">Instagram</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CREATORS.map((c) => (
          <div key={c.name} className="rounded-xl border border-[#eee] p-2.5">
            <div className="w-full aspect-square rounded-lg mb-2" style={{ background: `linear-gradient(135deg, ${hue(c.name)}, ${hue(c.name, 40)})` }} />
            <div className="text-[12px] font-semibold truncate">{c.name}</div>
            <div className="text-[10px] text-[#999] truncate">{c.city}</div>
            <div className="mt-1 flex justify-between text-[10px]">
              <span className="text-[#777]">{c.f}</span>
              <span style={{ color: ACCENT }}>{c.m}%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-[#eee] p-3">
        <div className="text-[12px] font-semibold mb-2">Active Campaigns</div>
        <div className="flex items-center justify-between text-[11px] text-[#666]">
          <span>Lakme Sun Expert Promotion</span><span>1,622 views</span><span>29 proposals</span>
        </div>
      </div>
    </Panel>
  );
}

function ProfileMock() {
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2 mb-4 text-[12px] text-[#666]">
        <span className="font-semibold text-[#111]">Profile Summary</span>
        <span className="px-2 py-0.5 rounded bg-[#f3f3f3]">@thekuldeepsinghania</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat k="Followers" v="3.7M" />
        <Stat k="Engagement %" v="8.6" />
        <Stat k="Total contents" v="386" />
      </div>
      <div className="text-[11px] uppercase tracking-wider text-[#999] mb-2">Content engagement rate</div>
      <Sparkline />
      <div className="mt-3 grid grid-cols-3 gap-3 text-[11px] text-[#666]">
        <div>Avg views<br /><b className="text-[#111]">6.6M</b></div>
        <div>Avg likes<br /><b className="text-[#111]">1.0M</b></div>
        <div>Avg comments<br /><b className="text-[#111]">6.6K</b></div>
      </div>
    </Panel>
  );
}

function FiltersMock() {
  const rows = [
    { n: 'Bushra Lokeman', f: '23.0K', er: '0.50%' },
    { n: 'Rubab Mukarram', f: '32.6K', er: '0.70%' },
    { n: 'Athulya Ashokan', f: '503.6K', er: '1.40%' },
    { n: 'Swapnil Dwivedi', f: '30.4K', er: '6.10%' },
    { n: 'Supriya Katiyar', f: '131.7K', er: '1.30%' },
  ];
  return (
    <Panel className="p-4 relative">
      <div className="flex items-center gap-2 mb-3 text-[12px]">
        <span className="flex-1 px-2 py-1.5 rounded-md bg-[#f5f5f5] text-[#888]">Find influencers to collaborate with</span>
        <span className="px-2 py-1 rounded-md text-white text-[11px]" style={{ background: ACCENT }}>+ Campaign</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.n} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[#faf9ff] text-[12px]">
            <div className="w-7 h-7 rounded-full shrink-0" style={{ background: `linear-gradient(135deg, ${hue(r.n)}, ${hue(r.n, 40)})` }} />
            <span className="flex-1 truncate font-medium">{r.n}</span>
            <span className="text-[#999] w-14 text-right">{r.f}</span>
            <span className="text-[#999] w-12 text-right">{r.er}</span>
            <span className="px-2 py-0.5 rounded text-white text-[11px]" style={{ background: ACCENT }}>Accept</span>
          </div>
        ))}
      </div>
      <div className="absolute -bottom-5 -right-3 w-52 rounded-xl bg-white border border-[#eee] shadow-xl p-3">
        <div className="text-[12px] font-semibold mb-2">Counter Offer</div>
        <div className="text-[11px] text-[#999] mb-1">Offer price</div>
        <div className="h-7 rounded-md border border-[#eee] mb-2" />
        <div className="flex gap-2">
          <span className="flex-1 text-center text-[11px] py-1 rounded border border-[#eee]">Cancel</span>
          <span className="flex-1 text-center text-[11px] py-1 rounded text-white" style={{ background: ACCENT }}>Send</span>
        </div>
      </div>
    </Panel>
  );
}

function CollabMock() {
  const rows = [
    { n: 'Upasana Kamineni', f: '13.0M', er: '4.00%' },
    { n: 'Shera Jat', f: '9.6M', er: '1.00%' },
    { n: 'Allu Sneha Reddy', f: '9.4M', er: '3.0%' },
    { n: 'Filmozo', f: '8.1M', er: '10.8%' },
    { n: 'Hussein Omer', f: '7.1M', er: '638.3K' },
  ];
  return (
    <Panel className="p-4 relative">
      <div className="flex items-center gap-2 mb-3 text-[11px] text-[#888]">
        <span className="px-2 py-1 rounded bg-[#f5f5f5]">Instagram</span>
        <span className="px-2 py-1 rounded" style={{ background: ACCENT_SOFT, color: ACCENT }}>Category: Finance ✕</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.n} className="flex items-center gap-3 px-2 py-2 text-[12px]">
            <input type="checkbox" className="accent-[#F2542D]" readOnly />
            <div className="w-7 h-7 rounded-full shrink-0" style={{ background: `linear-gradient(135deg, ${hue(r.n)}, ${hue(r.n, 40)})` }} />
            <span className="flex-1 truncate font-medium">{r.n}</span>
            <span className="text-[#999] w-14 text-right">{r.f}</span>
            <span className="px-2 py-0.5 rounded text-white text-[11px]" style={{ background: ACCENT }}>Shortlist</span>
          </div>
        ))}
      </div>
      <div className="absolute -bottom-6 right-2 w-48 rounded-xl bg-white border border-[#eee] shadow-xl p-3">
        <div className="text-[12px] font-semibold mb-2">Add to list</div>
        {['Finance Vivek', 'Content Creators', 'Chef'].map((l) => (
          <div key={l} className="text-[11px] text-[#666] py-1 border-b border-[#f3f3f3] last:border-0">{l}</div>
        ))}
        <div className="mt-2 text-center text-[11px] py-1 rounded text-white" style={{ background: ACCENT }}>Add to list</div>
      </div>
    </Panel>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-[#eee] p-3">
      <div className="text-[18px] font-bold tabular-nums">{v}</div>
      <div className="text-[11px] text-[#999]">{k}</div>
    </div>
  );
}

function Sparkline() {
  const pts = [18, 24, 16, 30, 22, 38, 28, 44, 34, 50];
  const w = 320, h = 70;
  const max = Math.max(...pts);
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - (p / max) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[70px]">
      <polyline points={d} fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const FAQS = [
  { q: 'How many influencers can I search?', a: 'Search across 2.5 lakh+ Indian creators on Instagram and YouTube, with 12+ data metrics per profile.' },
  { q: 'What filters are available?', a: 'Category, niche, location, language, followers, engagement rate, audience demographics, and creator traits — combine any of them.' },
  { q: 'Can I see audience quality?', a: 'Yes — every creator carries a credibility score and fake-follower signals so you avoid inflated accounts.' },
  { q: 'How do I shortlist creators?', a: 'Add creators to curated lists or recruit them straight into a campaign program from the results.' },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="py-20" style={{ background: ACCENT_SOFT }}>
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-10">Frequently asked questions</h2>
        <div className="space-y-2">
          {FAQS.map((f, i) => (
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

function hue(seed: string, shift = 0): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${(h + shift) % 360} 70% 55%)`;
}
