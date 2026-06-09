'use client';

import { useEffect, useRef, useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';

// ---- Reveal-on-scroll hook (no animation library needed) -----------------
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

// ---- Simulated "AI" content ideas per niche ------------------------------
interface Idea {
  hook: string;
  format: 'Reel' | 'Carousel' | 'Story';
  est: number; // predicted performance 0-100
}

const NICHES = ['Fashion', 'Food', 'Fitness', 'Travel', 'Beauty', 'Tech', 'Comedy', 'Finance'];

const IDEAS: Record<string, Idea[]> = {
  Fashion: [
    { hook: '“₹500 vs ₹5,000 outfit” — same vibe, half the price', format: 'Reel', est: 92 },
    { hook: 'Style one saree 5 ways for the festive season', format: 'Carousel', est: 85 },
    { hook: 'GRWM for a big-fat-Indian wedding', format: 'Reel', est: 78 },
  ],
  Food: [
    { hook: 'I tried the most-hyped street food in your city', format: 'Reel', est: 90 },
    { hook: '3 under-₹100 meals that actually slap', format: 'Carousel', est: 83 },
    { hook: 'POV: ordering everything on the menu', format: 'Reel', est: 80 },
  ],
  Fitness: [
    { hook: '30-day transformation — day 1 vs day 30', format: 'Reel', est: 88 },
    { hook: '5 desi foods that are secretly high-protein', format: 'Carousel', est: 81 },
    { hook: 'No-gym home workout you can do in 10 min', format: 'Reel', est: 76 },
  ],
  Travel: [
    { hook: '₹10,000 weekend trip — full breakdown', format: 'Carousel', est: 89 },
    { hook: 'Hidden spots locals don’t want you to know', format: 'Reel', est: 84 },
    { hook: 'Pack with me: 5 days in one backpack', format: 'Reel', est: 74 },
  ],
  Beauty: [
    { hook: '₹0 glow-up using things in your kitchen', format: 'Reel', est: 86 },
    { hook: '10-min wedding-guest makeup', format: 'Reel', est: 82 },
    { hook: 'Drugstore vs luxury — can you tell?', format: 'Carousel', est: 79 },
  ],
  Tech: [
    { hook: '5 free apps that feel illegal to know', format: 'Carousel', est: 91 },
    { hook: 'Best phone under ₹20k — honest review', format: 'Reel', est: 83 },
    { hook: 'Set up your phone like a pro in 60s', format: 'Reel', est: 75 },
  ],
  Comedy: [
    { hook: 'Every Indian parent during exam season', format: 'Reel', est: 94 },
    { hook: 'Types of friends in every WhatsApp group', format: 'Reel', est: 87 },
    { hook: 'When the wifi goes down at home', format: 'Reel', est: 80 },
  ],
  Finance: [
    { hook: 'How I’d invest my first ₹10,000', format: 'Carousel', est: 88 },
    { hook: '3 money mistakes everyone makes at 22', format: 'Reel', est: 82 },
    { hook: 'SIP explained like you’re 5', format: 'Carousel', est: 77 },
  ],
};

function IdeaGenerator() {
  const [niche, setNiche] = useState('Fashion');
  const [generating, setGenerating] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>(IDEAS.Fashion!);

  function generate(n: string) {
    setNiche(n);
    setGenerating(true);
    setIdeas([]);
    window.setTimeout(() => {
      setIdeas(IDEAS[n] ?? []);
      setGenerating(false);
    }, 650);
  }

  return (
    <div className="rounded-3xl border border-border bg-white shadow-card overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: ACCENT }} />
        <span className="text-[13px] font-semibold text-ink-900">AI Content Ideas</span>
        <span className="text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded text-white" style={{ background: ACCENT }}>
          live demo
        </span>
        <span className="ml-auto text-[12px] text-ink-400">pick your niche →</span>
      </div>

      <div className="px-6 pt-4 flex flex-wrap gap-2">
        {NICHES.map((n) => (
          <button
            key={n}
            onClick={() => generate(n)}
            className={`px-3 py-1.5 rounded-full text-[13px] border transition-colors ${
              niche === n ? 'text-white border-transparent' : 'text-ink-600 border-border hover:bg-[#faf9ff]'
            }`}
            style={niche === n ? { background: ACCENT } : undefined}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="p-6 grid sm:grid-cols-3 gap-3 min-h-[210px]">
        {generating
          ? [0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-border p-4 animate-pulse">
                <div className="h-3 w-3/4 rounded bg-[#eee]" />
                <div className="mt-2 h-3 w-1/2 rounded bg-[#f1f1f1]" />
                <div className="mt-6 h-2 w-full rounded bg-[#f1f1f1]" />
              </div>
            ))
          : ideas.map((idea, i) => (
              <div
                key={idea.hook}
                className="group rounded-2xl border border-border p-4 hover:-translate-y-1 hover:shadow-card transition-all"
                style={{ animation: `ii-rise .45s ${i * 90}ms both` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ background: ACCENT_SOFT, color: ACCENT }}
                  >
                    {idea.format}
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums text-ink-500">{idea.est}% match</span>
                </div>
                <p className="text-[13.5px] font-medium text-ink-900 leading-snug">{idea.hook}</p>
                <div className="mt-3 h-1.5 rounded-full bg-[#f0eefc] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${idea.est}%`,
                      background: `linear-gradient(90deg, ${ACCENT}, #9b7bff)`,
                      transition: 'width .7s ease',
                    }}
                  />
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}

// ---- Toolkit tabs --------------------------------------------------------
interface Tool {
  t: string;
  d: string;
}
const TOOLKIT: { group: string; blurb: string; tools: Tool[] }[] = [
  {
    group: 'Ideate',
    blurb: 'Never stare at a blank screen again.',
    tools: [
      { t: 'AI content ideas', d: 'Fresh, niche-specific hooks and formats generated on demand.' },
      { t: 'Trend radar', d: 'See what’s blowing up in your category right now, before it peaks.' },
    ],
  },
  {
    group: 'Create',
    blurb: 'Cut the busywork around every post.',
    tools: [
      { t: 'Caption & hashtag writer', d: 'On-brand captions and the right hashtags in one click.' },
      { t: 'Repurpose anywhere', d: 'Turn one video into a reel, short, and story automatically.' },
    ],
  },
  {
    group: 'Predict',
    blurb: 'Stop posting blind.',
    tools: [
      { t: 'Performance predictor', d: 'Estimated likes and views before you hit publish.' },
      { t: 'Best time to post', d: 'Personalised posting windows from your own audience data.' },
    ],
  },
  {
    group: 'Manage',
    blurb: 'Your collabs, organised for you.',
    tools: [
      { t: 'Brief inbox & deadlines', d: 'Every brand brief, deliverable and due date in one place.' },
      { t: 'Comment-to-DM autoreplies', d: 'Turn comments into conversations without lifting a finger.' },
      { t: 'Media library', d: 'All your shoots and assets, searchable and reusable.' },
    ],
  },
  {
    group: 'Get paid',
    blurb: 'Know your worth, get paid on time.',
    tools: [
      { t: 'Rate calculator', d: 'A fair price for every post, based on your reach and engagement.' },
      { t: 'Auto-invoicing & payouts', d: 'Invoices raised and payments tracked — no follow-ups.' },
    ],
  },
];

function Toolkit() {
  const [active, setActive] = useState(0);
  const current = TOOLKIT[active]!;
  return (
    <div className="mt-6 rounded-3xl border border-border bg-white shadow-card overflow-hidden">
      <div className="flex flex-wrap gap-1 p-2 border-b border-border bg-[#fafafc]">
        {TOOLKIT.map((g, i) => (
          <button
            key={g.group}
            onClick={() => setActive(i)}
            className={`px-4 py-2 rounded-xl text-[13.5px] font-medium transition-colors ${
              active === i ? 'text-white' : 'text-ink-600 hover:bg-white'
            }`}
            style={active === i ? { background: ACCENT } : undefined}
          >
            {g.group}
          </button>
        ))}
      </div>
      <div key={active} className="p-6" style={{ animation: 'ii-fade .35s both' }}>
        <p className="text-[15px] font-semibold text-ink-900 mb-4">{current.blurb}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {current.tools.map((tool) => (
            <div
              key={tool.t}
              className="rounded-2xl border border-border p-4 hover:-translate-y-1 hover:shadow-card transition-all"
            >
              <div className="w-9 h-9 rounded-xl grid place-items-center mb-3 font-bold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                {tool.t.charAt(0)}
              </div>
              <div className="font-semibold text-ink-900 text-[14.5px]">{tool.t}</div>
              <p className="mt-1 text-[13px] text-ink-500 leading-relaxed">{tool.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CreatorToolkit() {
  const { ref, shown } = useReveal<HTMLDivElement>();
  return (
    <section className="max-w-6xl mx-auto px-6 py-16">
      <style>{`
        @keyframes ii-rise { from { opacity:0; transform: translateY(12px) } to { opacity:1; transform:none } }
        @keyframes ii-fade { from { opacity:0 } to { opacity:1 } }
      `}</style>
      <div
        ref={ref}
        className="transition-all duration-700"
        style={{ opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(24px)' }}
      >
        <div className="text-center mb-10">
          <span className="inline-block px-4 py-1.5 rounded-full bg-white border border-border shadow-sm text-[13px] font-semibold" style={{ color: ACCENT }}>
            Your AI creator toolkit
          </span>
          <h2 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-ink-900">
            Less busywork. More creating.
          </h2>
          <p className="mt-2 text-[15px] text-ink-600 max-w-2xl mx-auto">
            From the first idea to the final payout — the boring parts are handled, so you can focus
            on what you do best.
          </p>
        </div>

        <IdeaGenerator />
        <Toolkit />
      </div>
    </section>
  );
}
