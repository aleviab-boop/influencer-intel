import type { ReactNode } from 'react';
import { MarketingNav, MarketingFooter, ACCENT } from '@/components/marketing';

export const LEGAL_CONTACT = 'privacy@influencerintel.com';
export const SUPPORT_CONTACT = 'support@influencerintel.com';

// Shared shell for the legal/policy pages (Privacy, Terms, Data deletion).
// Server component — the content is static; MarketingNav handles its own state.
export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        <div className="border-b border-border" style={{ background: 'linear-gradient(120deg,#ffffff 0%,#f7f5ff 55%,#f2ecff 100%)' }}>
          <div className="max-w-3xl mx-auto px-6 py-14">
            <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>Legal</div>
            <h1 className="mt-2 text-[34px] font-bold tracking-tight text-ink-900">{title}</h1>
            <p className="mt-2 text-[13px] text-ink-400">Last updated {updated}</p>
            {intro && <p className="mt-4 text-[15px] leading-relaxed text-ink-600">{intro}</p>}
          </div>
        </div>
        <article className="max-w-3xl mx-auto px-6 py-12">{children}</article>
      </main>
      <MarketingFooter />
    </div>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="text-[19px] font-bold text-ink-900 mb-3">{heading}</h2>
      <div className="space-y-3 text-[14.5px] leading-relaxed text-ink-600">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ACCENT }} />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}
