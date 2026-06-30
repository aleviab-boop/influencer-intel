'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from '@/components/marketing';

const ACCENT = '#6C4DF6';
const ACCENT_SOFT = '#F4F2FF';

type NavItem = { label: string; href: string; icon: string; soon?: boolean };

const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: 'home' },
  { label: 'Scraper', href: '/admin/scraper', icon: 'bot' },
  { label: 'Agency', href: '/admin/agency', icon: 'building' },
  { label: 'Influencer', href: '/admin/influencer', icon: 'user', soon: true },
];

function NavIcon({ name }: { name: string }) {
  const c = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'home':
      return (<svg {...c}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>);
    case 'bot':
      return (<svg {...c}><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M12 8V4M9 4h6" /><circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" /></svg>);
    case 'building':
      return (<svg {...c}><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></svg>);
    case 'user':
      return (<svg {...c}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" /></svg>);
    default:
      return null;
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <div className="min-h-screen flex bg-[#fafafc] text-[#111] font-sans">
      {/* sidebar */}
      <aside className="w-60 shrink-0 bg-white border-r border-[#ececf3] flex flex-col sticky top-0 h-screen">
        <Link href="/lander" className="flex items-center gap-2 px-5 h-16 border-b border-[#f1f1f6]">
          <BrandMark size={28} />
          <span className="text-[15px] font-bold tracking-tight">Influencer Intel</span>
        </Link>

        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#aab] mt-2">
          Admin
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const inner = (
              <span
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-colors ${
                  active ? 'text-white' : item.soon ? 'text-[#bbb]' : 'text-[#444] hover:bg-[#f5f3ff]'
                }`}
                style={active ? { background: ACCENT } : undefined}
              >
                <NavIcon name={item.icon} />
                <span className="flex-1">{item.label}</span>
                {item.soon && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#f1f1f6] text-[#999]">
                    Soon
                  </span>
                )}
              </span>
            );
            return item.soon ? (
              <div key={item.href} className="cursor-not-allowed" title="Coming soon">{inner}</div>
            ) : (
              <Link key={item.href} href={item.href}>{inner}</Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[#f1f1f6]">
          <Link
            href="/lander"
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] font-medium text-[#666] hover:bg-[#f5f3ff]"
            style={{ color: ACCENT, background: ACCENT_SOFT }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            Open Agency Lander
          </Link>
        </div>
      </aside>

      {/* main */}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
