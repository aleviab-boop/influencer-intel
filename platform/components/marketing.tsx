'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookDemoButton } from './book-demo';

// Scroll-reveal: fades + rises its children in when they enter the viewport.
export function Reveal({
  children,
  className = '',
  delay = 0,
  y = 22,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : `translateY(${y}px)`,
        transition: `opacity .6s ease ${delay}s, transform .6s cubic-bezier(.22,.61,.36,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

export const ACCENT = '#6C4DF6';
export const ACCENT_SOFT = '#F4F2FF';

// Brand mark: two figures forming a heart with three dots, in the pink/blue/
// yellow palette. Replaces the old "i" tile. Transparent background so it sits
// on both light (nav) and dark (footer) surfaces.
export function BrandMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden role="img">
      <path d="M11 37C9 23 23 17 32 27c9-10 23-4 21 10" stroke="#4FB3D9" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M32 38C24 34 15 38 15 45c0 6 9 11 17 13z" fill="#D83E83" />
      <path d="M32 38c8-4 17 0 17 7 0 6-9 11-17 13z" fill="#ECBF4C" />
      <circle cx="23" cy="31" r="4" fill="#D83E83" />
      <circle cx="32" cy="31" r="4" fill="#4FB3D9" />
      <circle cx="41" cy="31" r="4" fill="#ECBF4C" />
    </svg>
  );
}

// True once a session exists (set on login: ii_role, or creator: creator_handle).
export function useLoggedIn(): [boolean, () => void] {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);
  const read = () => {
    try {
      setLoggedIn(Boolean(localStorage.getItem('ii_role') || localStorage.getItem('creator_handle')));
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);
  const logout = () => {
    try {
      localStorage.removeItem('ii_role');
      localStorage.removeItem('creator_handle');
    } catch {
      /* ignore */
    }
    setLoggedIn(false);
    router.replace('/login'); // back to the sign-in (creator / agency) page
  };
  return [loggedIn, logout];
}

// Top-right account avatar — always shown. Signed out: a generic person icon
// whose menu offers log in / sign up. Signed in: a creator's Instagram photo
// (initials fallback) with a menu showing the handle/role and a log-out action.
export function AccountMenu() {
  const [loggedIn, logout] = useLoggedIn();
  const [handle, setHandle] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setHandle(localStorage.getItem('creator_handle'));
        setRole(localStorage.getItem('ii_role'));
      } catch {
        /* ignore */
      }
    };
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, [loggedIn]);

  const label = handle ? `@${handle}` : role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Guest';
  const showPhoto = loggedIn && handle && !imgErr;
  const initials = loggedIn ? (handle || role || 'U').slice(0, 2).toUpperCase() : null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account"
        className="w-9 h-9 rounded-full overflow-hidden grid place-items-center ring-2 ring-[#ececec] hover:ring-[#d9d2f7] transition-shadow"
        style={{ background: loggedIn ? ACCENT : '#f2effc' }}
      >
        {showPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/ig-avatar?handle=${encodeURIComponent(handle!)}`} alt={label} onError={() => setImgErr(true)} className="w-full h-full object-cover" />
        ) : initials ? (
          <span className="text-white text-[12px] font-semibold">{initials}</span>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
          </svg>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-52 rounded-xl bg-white border border-[#ececec] shadow-[0_16px_50px_rgba(0,0,0,0.12)] overflow-hidden">
            {loggedIn ? (
              <>
                <div className="px-4 py-3 border-b border-[#f3f3f3]">
                  <div className="text-[13px] font-semibold text-[#111] truncate">{label}</div>
                  <div className="text-[11px] text-[#999]">{handle ? 'Creator account' : 'Signed in'}</div>
                </div>
                <button onClick={() => { setOpen(false); logout(); }} className="w-full text-left px-4 py-2.5 text-[13px] text-[#444] hover:bg-[#f6f4ff]">
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-[13px] text-[#444] hover:bg-[#f6f4ff]">Log in</Link>
                <Link href="/start" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-[13px] font-medium hover:bg-[#f6f4ff]" style={{ color: ACCENT }}>Sign up</Link>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export const FEATURE_MENU: { label: string; href: string; icon: string }[] = [
  { label: 'Influencer Search', href: '/influencer-search', icon: 'search' },
  { label: 'AI Content Generator', href: '/tools/content-ideas', icon: 'spark' },
  { label: 'Reply Assistant', href: '/tools/reply-assistant', icon: 'chat' },
  { label: 'Media Kit Generator', href: '/tools/media-kit', icon: 'instagram' },
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
    case 'spark':
      return (<svg {...common}><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z" /></svg>);
    default:
      return null;
  }
}

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-[#eee]">
      <div className="w-full px-5 lg:px-10 h-16 flex items-center justify-between">
        <Link href="/lander" className="flex items-center gap-2">
          <BrandMark size={30} />
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
          <Link href="/trending" className="hover:text-[#111]">Trending</Link>
          <Link href="/pricing" className="hover:text-[#111]">Pricing</Link>
          <Link href="/for-influencers" className="hover:text-[#111]">For Influencers</Link>
        </nav>
        <div className="flex items-center gap-3">
          <BookDemoButton />
          <AccountMenu />
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
            <BrandMark size={28} />
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
