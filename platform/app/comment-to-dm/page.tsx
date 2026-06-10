'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MarketingNav, MarketingFooter, Reveal, ACCENT, ACCENT_SOFT } from '@/components/marketing';

export default function CommentToDmPage() {
  return (
    <div className="min-h-screen bg-white text-[#111] font-sans">
      <MarketingNav />
      <Hero />
      <FeatureRow
        title="Automated Comment Triggers"
        bullets={[
          'Automatically detect and respond to comments on influencer posts in real time.',
          'Set custom trigger keywords to initiate personalized DM conversations instantly.',
          'Engage every potential lead without manual monitoring or missed opportunities.',
          'Scale engagement across multiple influencer posts and campaigns simultaneously.',
          'Reduce response time from hours to seconds with intelligent automation.',
        ]}
        mock={<AutomationsMock />}
      />
      <FeatureRow
        flip
        title="Personalized DM Flows"
        bullets={[
          'Send tailored DM sequences based on comment intent and user behaviour.',
          'Craft conversion-focused message flows that feel human, not automated.',
          'Guide prospects from awareness to action with multi-step DM journeys.',
          'Customize messaging by campaign, product, or influencer for maximum relevance.',
          'A/B test DM scripts to continuously improve open and response rates.',
        ]}
        mock={<DmFlowMock />}
      />
      <FeatureRow
        title="Lead Capture & Qualification"
        bullets={[
          'Automatically collect and qualify leads directly from DM conversations.',
          'Capture user details, preferences, and intent without any manual input.',
          'Route high-intent leads to your sales or CRM pipeline seamlessly.',
          'Track every conversation and conversion from one centralized dashboard.',
          'Never lose a warm lead with automated follow-up reminders and retargeting.',
        ]}
        mock={<LeadCaptureMock />}
      />
      <StatsBand />
      <FAQ />
      <MarketingFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="grid-bg">
      <div className="max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.08]">
            Comment to DM automation for influencer campaigns
          </h1>
          <p className="mt-5 text-[17px] text-[#555] max-w-xl">
            Convert every comment into a high-converting DM conversation — automatically engage your
            audience, nurture leads, and drive campaign results at scale without manual effort.
          </p>
          <Link href="/automations" className="mt-7 inline-block px-6 py-3 rounded-xl text-white text-[15px] font-medium" style={{ background: ACCENT }}>
            Get Started →
          </Link>
        </div>
        <ChatMock />
      </div>
    </section>
  );
}

function FeatureRow({ title, bullets, mock, flip }: { title: string; bullets: string[]; mock: React.ReactNode; flip?: boolean }) {
  return (
    <section className="border-t border-[#f0f0f0]">
      <div className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
        <Reveal className={flip ? 'lg:order-2' : ''}>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">{title}</h2>
          <ul className="mt-5 space-y-3">
            {bullets.map((b) => (
              <li key={b} className="flex gap-3 text-[15px] text-[#555] leading-relaxed">
                <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ACCENT }} />
                {b}
              </li>
            ))}
          </ul>
          <Link href="/automations" className="mt-6 inline-flex items-center gap-1 text-[15px] font-medium" style={{ color: ACCENT }}>
            Get Started →
          </Link>
        </Reveal>
        <Reveal delay={0.12} className={flip ? 'lg:order-1' : ''}>{mock}</Reveal>
      </div>
    </section>
  );
}

// ---- mockups ------------------------------------------------------------

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white border border-[#eaeaea] shadow-[0_12px_50px_rgba(0,0,0,0.08)] ${className}`}>{children}</div>;
}

function ChatMock() {
  return (
    <Panel className="p-8 relative overflow-hidden" >
      <div className="absolute inset-0 -z-0" style={{ background: `radial-gradient(400px 200px at 60% 20%, ${ACCENT_SOFT}, rgba(255,255,255,0))` }} />
      <div className="relative flex items-center justify-center gap-4">
        <Avatar name="Aisha" />
        <div className="w-40 rounded-2xl border border-[#e8e8e8] bg-white p-3 shadow-sm">
          <div className="h-2.5 w-3/4 rounded-full mb-2" style={{ background: ACCENT }} />
          <div className="h-2.5 w-2/3 rounded-full bg-[#eee] mb-2" />
          <div className="h-2.5 w-5/6 rounded-full bg-[#eee] mb-2" />
          <div className="h-6 w-16 rounded-lg" style={{ background: ACCENT }} />
        </div>
        <Avatar name="Rohan" />
      </div>
      <div className="relative mt-6 flex justify-center gap-2 text-[11px] text-[#888]">
        <span className="px-2 py-1 rounded-full bg-[#f4f4f6]">💬 comment</span>
        <span className="px-2 py-1 rounded-full text-white" style={{ background: ACCENT }}>→ auto-DM</span>
        <span className="px-2 py-1 rounded-full bg-[#f4f4f6]">✓ lead</span>
      </div>
    </Panel>
  );
}

const AUTOMATIONS = [
  { n: 'Price Reply', d: 'Comments on "Summer Collection" · keyword: price', s: 'Active', r: '1,248' },
  { n: 'Link in Bio', d: 'Any comment on next post · any keyword', s: 'Active', r: '3,102' },
  { n: 'DM Welcome', d: 'Comments on "Intro Reel" · keyword: info', s: 'Active', r: '876' },
  { n: 'Product Drop', d: 'Comments on "New Drop" · keyword: drop', s: 'Paused', r: '542' },
  { n: 'Collab Inquiry', d: 'Any comment on next reel · keyword: collab', s: 'Active', r: '214' },
  { n: 'Giveaway Entry', d: 'Comments on "Giveaway" · keyword: join', s: 'Active', r: '549' },
];

function AutomationsMock() {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[13px] font-semibold">My Automations</div>
          <div className="text-[11px] text-[#999]">Manage and monitor all your comment automations</div>
        </div>
        <span className="px-2.5 py-1 rounded-md text-white text-[11px]" style={{ background: ACCENT }}>+ New Automation</span>
      </div>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[['Automations', '12'], ['Replies sent', '8,421'], ['Active now', '7'], ['Avg response', '1.2s']].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-[#eee] p-2">
            <div className="text-[15px] font-bold tabular-nums">{v}</div>
            <div className="text-[10px] text-[#999]">{k}</div>
          </div>
        ))}
      </div>
      <div className="space-y-1">
        {AUTOMATIONS.map((a) => (
          <div key={a.n} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[#faf9ff]">
            <span className="w-6 h-6 rounded-md grid place-items-center text-white text-[11px]" style={{ background: ACCENT }}>⚡</span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium truncate">{a.n}</div>
              <div className="text-[10px] text-[#aaa] truncate">{a.d}</div>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${a.s === 'Active' ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'}`}>{a.s}</span>
            <span className="text-[11px] text-[#999] tabular-nums w-12 text-right">{a.r}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DmFlowMock() {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] font-semibold">Create Automation</span>
        <span className="px-2 py-1 rounded text-white text-[11px]" style={{ background: ACCENT }}>Go Live</span>
      </div>
      <div className="flex gap-2 mb-4 text-[10px]">
        {['Basic Info', 'Trigger', 'Action', 'Review'].map((s, i) => (
          <span key={s} className={`px-2 py-1 rounded-full ${i === 0 ? 'text-white' : 'text-[#888] bg-[#f4f4f6]'}`} style={i === 0 ? { background: ACCENT } : undefined}>
            {i + 1}. {s}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="rounded-lg border border-[#eee] p-2">
            <div className="text-[10px] text-[#999] mb-1">When someone comments on</div>
            <div className="text-[11px]">◉ A specific post or reel</div>
            <div className="text-[11px] text-[#aaa]">○ Next post or reel</div>
          </div>
          <div className="rounded-lg border border-[#eee] p-2">
            <div className="text-[10px] text-[#999] mb-1">And the comment has</div>
            <div className="text-[11px]">◉ A specific keyword</div>
            <div className="h-6 rounded-md bg-[#f5f5f5] mt-1" />
          </div>
        </div>
        {/* phone preview */}
        <div className="rounded-xl bg-[#111] p-2">
          <div className="rounded-lg bg-[#1c1c1c] h-full p-2 text-white">
            <div className="text-[10px] mb-2">Instagram</div>
            <div className="aspect-square rounded-md bg-[#2a2a2a] mb-2" />
            <div className="flex gap-2 mb-2 text-[10px]">♡ ♥ ➤</div>
            <div className="h-2 w-2/3 rounded-full bg-[#333] mb-1" />
            <div className="h-2 w-1/2 rounded-full bg-[#333]" />
            <div className="mt-2 inline-block px-2 py-1 rounded-md text-[9px]" style={{ background: ACCENT }}>DM sent ✓</div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function LeadCaptureMock() {
  return (
    <Panel className="p-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-[#eee] p-3">
          <div className="text-[11px] text-[#999] mb-2">Captured leads</div>
          {['Priya · high intent', 'Aarav · pricing', 'Sara · collab', 'Dev · info'].map((l) => (
            <div key={l} className="flex items-center gap-2 py-1.5 text-[12px] border-b border-[#f3f3f3] last:border-0">
              <span className="w-2 h-2 rounded-full" style={{ background: ACCENT }} />
              {l}
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="rounded-xl p-3 text-white" style={{ background: ACCENT }}>
            <div className="text-2xl font-bold">68%</div>
            <div className="text-[11px] opacity-90">qualified → CRM</div>
          </div>
          <div className="rounded-xl border border-[#eee] p-3">
            <div className="text-2xl font-bold tabular-nums">2,341</div>
            <div className="text-[11px] text-[#999]">leads this month</div>
          </div>
        </div>
      </div>
    </Panel>
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

const FAQS = [
  { q: 'How does Comment to DM work?', a: 'Set a keyword for a post; when someone comments it, we automatically send them a personalized DM sequence — no manual monitoring.' },
  { q: 'Can I personalize the DMs?', a: 'Yes — build multi-step flows tailored by comment intent, campaign, product, or influencer, and A/B test scripts.' },
  { q: 'Does it qualify leads?', a: 'Conversations capture user details and intent, qualify leads automatically, and route high-intent ones to your CRM.' },
  { q: 'Which platforms are supported?', a: 'Instagram comment-to-DM at launch, with more channels planned.' },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="py-20" style={{ background: ACCENT_SOFT }}>
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-10">Frequently asked questions</h2>
        <div className="space-y-2">
          {FAQS.map((f, i) => (
            <div key={f.q} className="rounded-xl bg-white border border-[#ececff]">
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

function Avatar({ name }: { name: string }) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return <div className="w-16 h-16 rounded-full shrink-0" style={{ background: `linear-gradient(135deg, hsl(${h % 360} 70% 55%), hsl(${(h + 40) % 360} 70% 45%))` }} />;
}
