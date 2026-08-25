'use client';

import Link from 'next/link';
import { MarketingNav, MarketingFooter, ACCENT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

export default function ComingSoonPage() {
  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-white font-sans">
      <PageDoodles className="-z-10" />
      <MarketingNav />
      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl opacity-25" style={{ background: ACCENT }} />
          <div className="relative max-w-3xl mx-auto px-6 pt-24 pb-24 text-center">
            <span className="inline-block px-4 py-1.5 rounded-full bg-white border border-border shadow-sm text-[13px] font-semibold" style={{ color: ACCENT }}>Creator portal</span>

            <div className="mx-auto mt-8 flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            </div>

            <h1 className="mt-7 text-4xl md:text-5xl font-bold tracking-tight text-ink-900 leading-[1.08]">
              Coming <span style={{ color: ACCENT }}>soon</span>
            </h1>
            <p className="mt-5 text-[17px] text-ink-600 max-w-xl mx-auto">
              We&apos;re building a dedicated portal for creators — set your profile and rates,
              track your reel performance, and get matched with real brand campaigns. It&apos;s almost here.
            </p>

            <div className="mt-9 flex items-center justify-center gap-3 flex-wrap">
              <Link href="/for-influencers" className="px-6 py-3 rounded-xl text-white text-[15px] font-semibold hover:brightness-105 hover:-translate-y-0.5 transition-all" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>Back to creators</Link>
              <Link href="/" className="px-6 py-3 rounded-xl text-[15px] font-semibold border border-border hover:bg-[#faf9ff] transition-colors" style={{ color: ACCENT, borderColor: '#e3def9' }}>Go home</Link>
            </div>

            <p className="mt-6 text-[12px] text-ink-400">Free to join · No subscription · Keep 100% of your rate</p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
