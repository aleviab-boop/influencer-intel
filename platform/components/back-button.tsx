'use client';

import { useRouter, usePathname } from 'next/navigation';

// A single, consistent "go back" control shared across every header. Uses the
// browser history so it always returns to wherever the user actually came from;
// if there's no in-app history (e.g. the page was opened directly or via a deep
// link) it falls back to the marketing home so the button is never a dead end.
//
// Hidden on the true entry points (home / role chooser) where "back" is
// meaningless. Add more roots here if new landing pages appear.
const ROOTS = new Set<string>(['/', '/lander', '/login']);

export function BackButton({ fallback = '/lander' }: { fallback?: string }): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();

  if (!pathname || ROOTS.has(pathname)) return null;

  const goBack = () => {
    // window.history.length > 1 means there's somewhere to go back to within
    // this tab; otherwise send them to a sensible landing page.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="Go back"
      className="inline-flex items-center gap-1.5 rounded-full border border-[#e7e7ee] bg-white/70 px-2.5 py-1.5 text-[13px] font-medium text-[#555] hover:text-[#111] hover:border-[#d5d5e0] transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
      </svg>
      <span className="hidden sm:inline">Back</span>
    </button>
  );
}
