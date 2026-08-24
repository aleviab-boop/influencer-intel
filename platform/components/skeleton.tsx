import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

// Skeleton primitives + a list/table page skeleton shared by loading.tsx route
// fallbacks. Server-safe (pure CSS shimmer via the .ii-skel class). Shown while
// a route's JS bundle loads on navigation, so users see structure, not a blank.

export function Skel({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`ii-skel ${className}`} style={style} aria-hidden />;
}

// Inline "couldn't load" state with an optional retry — used by client pages so
// a failed fetch reads as an error (recoverable) rather than an empty result.
export function InlineError({
  message = 'We couldn’t load this right now.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="py-14 text-center rounded-2xl border border-dashed border-border bg-white" role="alert">
      <div className="mx-auto w-11 h-11 rounded-full grid place-items-center" style={{ background: '#fef2f2' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e11d48" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      </div>
      <p className="mt-3 text-[14px] text-ink-600">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5"
          style={{ background: ACCENT }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

// A hero band + toolbar + table of shimmer rows — matches the layout of the
// data-heavy marketing/tool pages (database, payouts, trending, creators).
export function ListPageSkeleton({
  rows = 8,
  showStats = false,
}: {
  rows?: number;
  showStats?: boolean;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-white font-sans" aria-busy>
      <MarketingNav />
      <main className="flex-1">
        {/* Hero band */}
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="relative max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
            <Skel className="h-6 w-40 mx-auto rounded-full" />
            <Skel className="mt-5 h-9 w-3/4 max-w-lg mx-auto" />
            <Skel className="mt-3 h-4 w-2/3 max-w-md mx-auto" />
            <Skel className="mt-6 h-11 w-44 mx-auto rounded-xl" />
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-10">
          {showStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl bg-white border border-border p-4 shadow-card">
                  <Skel className="h-7 w-24" />
                  <Skel className="mt-2 h-3 w-16" />
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <Skel className="h-4 w-40" />
            <Skel className="h-4 w-20" />
          </div>

          <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
            <div className="px-4 py-2.5 bg-[#f7f7fb] flex items-center gap-4">
              <Skel className="h-3 w-28" />
              <Skel className="h-3 w-20" />
              <Skel className="h-3 w-16 ml-auto" />
            </div>
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="px-4 py-3 border-t border-border-soft flex items-center gap-4">
                <Skel className="h-8 w-8 rounded-full shrink-0" />
                <Skel className="h-4 w-40" />
                <Skel className="h-4 w-24" />
                <Skel className="h-4 w-16 ml-auto" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
