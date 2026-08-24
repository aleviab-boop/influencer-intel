import Link from 'next/link';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { Doodle } from '@/components/doodles';

// Branded 404 — replaces Next.js's default black-and-white page so a mistyped
// or dead URL still lands somewhere on-brand, with a way back into the product.
// Server component (static): the nav/footer manage their own client state.

const LINKS: { label: string; href: string; sub: string }[] = [
  { label: 'Home', href: '/lander', sub: 'Back to the start' },
  { label: 'Find creators', href: '/influencer-search', sub: 'Search the database' },
  { label: 'Trending', href: '/trending', sub: "What's hot right now" },
  { label: 'Pricing', href: '/pricing', sub: 'Plans & features' },
];

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.14), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.13), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.11), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
        <div className="grid-bg absolute inset-0 opacity-40" />

        {/* Floating doodles */}
        <Doodle shape={0} color="#8B7BF7" className="ii-floatr pointer-events-none absolute left-[10%] top-24 h-9 w-9 opacity-40" style={{ ['--r' as string]: '12deg' }} />
        <Doodle shape={1} color="#EC4899" className="ii-floatr pointer-events-none absolute right-[12%] top-32 h-8 w-8 opacity-35" style={{ ['--r' as string]: '-10deg', animationDelay: '1.1s' }} />
        <Doodle shape={5} color="#F59E0B" className="ii-floatr pointer-events-none absolute left-[18%] bottom-24 h-8 w-8 opacity-35" style={{ ['--r' as string]: '8deg', animationDelay: '.6s' }} />
        <Doodle shape={3} color="#10B981" className="ii-floatr pointer-events-none absolute right-[16%] bottom-28 h-9 w-9 opacity-30" style={{ ['--r' as string]: '-14deg', animationDelay: '1.8s' }} />

        <div className="relative max-w-2xl mx-auto px-6 py-20 md:py-28 text-center">
          <div className="text-[86px] md:text-[120px] font-extrabold leading-none tracking-tight"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff 55%, #EC4899)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
            404
          </div>
          <h1 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-ink-900">This page wandered off</h1>
          <p className="mt-3 text-[15px] text-ink-600 max-w-md mx-auto leading-relaxed">
            The link may be broken or the page may have moved. Here are a few good places to pick back up.
          </p>

          <div className="mt-9 grid grid-cols-2 gap-3 max-w-md mx-auto text-left">
            {LINKS.map((l) => (
              <Link key={l.label} href={l.href}
                className="group rounded-2xl bg-white border border-border shadow-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
                <div className="text-[14px] font-semibold text-ink-900 flex items-center gap-1.5">
                  {l.label}
                  <span className="transition-transform duration-300 group-hover:translate-x-0.5" style={{ color: ACCENT }}>→</span>
                </div>
                <div className="text-[12px] text-ink-500 mt-0.5">{l.sub}</div>
              </Link>
            ))}
          </div>

          <Link href="/lander"
            className="inline-block mt-8 px-6 py-3 rounded-xl text-white text-[15px] font-semibold transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5"
            style={{ background: ACCENT }}>
            Take me home
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
