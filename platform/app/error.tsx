'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { Doodle } from '@/components/doodles';

// Branded route-level error boundary — replaces Next.js's default error screen
// when a segment throws at runtime. Renders inside the root layout, so the
// global doodle field / scroll motion stay in place. Client component (required
// for error boundaries); `reset` re-renders the failed segment.

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface the error for debugging; the digest links a client report to the
    // server log without leaking the message to the user.
    console.error('Route error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.14), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.13), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.11), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
        <div className="grid-bg absolute inset-0 opacity-40" />

        {/* Floating doodles */}
        <Doodle shape={6} color="#8B7BF7" className="ii-floatr pointer-events-none absolute left-[12%] top-24 h-9 w-9 opacity-40" style={{ ['--r' as string]: '10deg' }} />
        <Doodle shape={1} color="#EC4899" className="ii-floatr pointer-events-none absolute right-[14%] top-32 h-8 w-8 opacity-35" style={{ ['--r' as string]: '-12deg', animationDelay: '1.1s' }} />
        <Doodle shape={5} color="#F59E0B" className="ii-floatr pointer-events-none absolute left-[20%] bottom-24 h-8 w-8 opacity-35" style={{ ['--r' as string]: '8deg', animationDelay: '.7s' }} />

        <div className="relative max-w-xl mx-auto px-6 py-20 md:py-28 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl grid place-items-center shadow-card" style={{ background: '#fff', border: '1px solid var(--border, #eee)' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
          </div>
          <h1 className="mt-6 text-2xl md:text-3xl font-bold tracking-tight text-ink-900">Something went wrong</h1>
          <p className="mt-3 text-[15px] text-ink-600 max-w-md mx-auto leading-relaxed">
            We hit an unexpected error loading this page. You can try again, or head back and pick up where you left off.
          </p>
          {error?.digest && (
            <p className="mt-2 text-[11px] text-ink-400 tabular-nums">Reference: {error.digest}</p>
          )}

          {/* Collapsed technical details — client render errors carry no digest,
              so this is the only way to see WHAT actually threw. error.message is
              preserved even in a minified production build, so it pinpoints the
              failing access; the stack helps when message alone is ambiguous. */}
          {(error?.message || error?.stack) && (
            <details className="mt-4 mx-auto max-w-md text-left">
              <summary className="cursor-pointer text-[12px] text-ink-400 hover:text-ink-600 select-none">
                Technical details
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-[#faf9ff] border border-border p-3 text-[11px] leading-relaxed text-ink-700 whitespace-pre-wrap break-words">
                {[error.name, error.message].filter(Boolean).join(': ')}
                {error.stack ? `\n\n${error.stack}` : ''}
              </pre>
            </details>
          )}

          <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={reset}
              className="px-6 py-3 rounded-xl text-white text-[15px] font-semibold transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5"
              style={{ background: ACCENT }}
            >
              Try again
            </button>
            <Link href="/lander"
              className="px-6 py-3 rounded-xl text-[15px] font-semibold border border-border text-ink-700 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
              Go home
            </Link>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
