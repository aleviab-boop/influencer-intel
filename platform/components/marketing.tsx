import Link from 'next/link';

export const ACCENT = '#6C4DF6';
export const ACCENT_SOFT = '#F4F2FF';

export const FEATURE_MENU: { label: string; href: string; icon: string }[] = [
  { label: 'Influencer Search', href: '/influencer-search', icon: 'search' },
  { label: 'Campaign Management', href: '/campaign-management', icon: 'list' },
  { label: 'Comment to DM', href: '/comment-to-dm', icon: 'chat' },
  { label: 'Competitor Analysis', href: '/competitor-analysis', icon: 'bars' },
  { label: 'Influencer Database', href: '/influencer-database', icon: 'database' },
  { label: 'Campaign Analytics', href: '/campaign-analytics', icon: 'clock' },
  { label: 'Media Management', href: '/media-management', icon: 'video' },
  { label: 'Influencer Payouts', href: '/influencer-payouts', icon: 'payout' },
];

export function FeatureIcon({ name }: { name: string }) {
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
    case 'instagram':
      return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>);
    default:
      return null;
  }
}

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-[#eee]">
      <div className="w-full px-5 lg:px-10 h-16 flex items-center justify-between">
        <Link href="/lander" className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg grid place-items-center text-white text-sm font-bold" style={{ background: ACCENT }}>
            i
          </span>
          <span className="text-[15px] font-bold tracking-tight">Influencer Intel</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-[14px] text-[#444]">
          <Link href="/lander" className="hover:text-[#111]">Home</Link>
          <div className="relative group h-16 flex items-center">
            <button className="flex items-center gap-1 group-hover:text-[var(--ii-accent)] transition-colors">
              Features
              <svg className="w-3.5 h-3.5 transition-transform group-hover:rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 w-[340px] z-50 opacity-0 invisible translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0">
              <div className="rounded-2xl bg-white border border-[#ececec] shadow-[0_16px_50px_rgba(0,0,0,0.12)] overflow-hidden">
                {FEATURE_MENU.map((f) => (
                  <Link key={f.label} href={f.href} className="flex items-center gap-3.5 px-5 py-3.5 border-b border-[#f3f3f3] last:border-0 hover:bg-[#f6f4ff] transition-colors">
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
          <Link href="/book-demo" className="px-4 py-2 rounded-lg text-white text-[14px] font-medium" style={{ background: ACCENT }}>
            Book a demo
          </Link>
        </div>
      </div>
    </header>
  );
}

function footerHref(label: string): string {
  const map: Record<string, string> = {
    'Authenticity Score': '/tools/fake-follower-checker',
    'ER Calculator': '/tools/er-calculator',
    'Influencer Database': '/influencer-database',
    'Campaign Management': '/campaigns',
    'Comment to DM': '/comment-to-dm',
    'Competitor Analysis': '/competitor-analysis',
    'Search': '/influencer-search',
    'Payouts': '/payouts',
  };
  return map[label] ?? '#';
}

export function MarketingFooter() {
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
                <li key={l}><a href={footerHref(l)} className="hover:text-white">{l}</a></li>
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
