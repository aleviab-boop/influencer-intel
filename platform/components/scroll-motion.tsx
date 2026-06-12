'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

// Global scroll-reveal: every <section> (outside nav/footer) fades + rises in as
// it scrolls into view. Driven by a plain scroll handler (not an
// IntersectionObserver) so it fires reliably — including right after a
// client-side navigation — and a safety pass guarantees content is never left
// hidden. Progressive enhancement: sections are only hidden once JS marks them.
export function ScrollMotion() {
  const pathname = usePathname();
  const firstRun = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // On a real route change, land at the top of the new page.
    if (firstRun.current) firstRun.current = false;
    else window.scrollTo(0, 0);

    const sections = () =>
      Array.from(document.querySelectorAll('section')).filter((el) => !el.closest('header, footer'));

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      sections().forEach((el) => el.classList.remove('ii-reveal'));
      return;
    }

    let raf = 0;
    const tick = () => {
      const h = window.innerHeight;
      for (const el of sections()) {
        const inview = el.classList.contains('ii-inview');
        if (!inview && !el.classList.contains('ii-reveal')) el.classList.add('ii-reveal');
        if (!inview && el.getBoundingClientRect().top < h - 60) el.classList.add('ii-inview');
      }
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        tick();
      });
    };

    tick(); // hide below-fold + reveal what's already visible
    requestAnimationFrame(tick); // re-run once layout settles

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const mo = new MutationObserver(schedule); // catch sections added later
    mo.observe(document.body, { childList: true, subtree: true });

    // Safety net: anything visible but somehow still hidden after a moment gets
    // revealed, so the page can never be stuck blank.
    const safety = window.setTimeout(() => {
      const h = window.innerHeight;
      for (const el of sections()) {
        if (!el.classList.contains('ii-inview') && el.getBoundingClientRect().top < h) {
          el.classList.add('ii-inview');
        }
      }
    }, 1000);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(safety);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      mo.disconnect();
    };
  }, [pathname]);

  return null;
}
