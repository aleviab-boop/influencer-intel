'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

// Global scroll-reveal: every <section> (outside the nav/footer) gently rises
// and fades in as it scrolls into view — on every page, no per-page wiring.
// Progressive enhancement: elements are only hidden once JS marks them, so
// content stays visible if JS is off. Respects prefers-reduced-motion.
export function ScrollMotion() {
  const pathname = usePathname();
  const firstRun = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // On a real route change (not the first load), land at the top of the new
    // page — so clicking a feature never drops you mid-page on the next one.
    if (firstRun.current) firstRun.current = false;
    else window.scrollTo(0, 0);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let io: IntersectionObserver | null = null;
    let mo: MutationObserver | null = null;

    const reveal = (el: Element) => {
      el.classList.add('ii-inview');
      io?.unobserve(el);
    };

    const observe = (el: Element) => {
      if (el.classList.contains('ii-reveal')) return; // already tracked
      el.classList.add('ii-reveal');
      // Anything already in (or above) the viewport — e.g. the hero of a page
      // you just navigated to — is revealed right away rather than waiting on
      // the observer, so navigated pages never look blank. Below-fold sections
      // animate in on scroll via the observer.
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        requestAnimationFrame(() => el.classList.add('ii-inview'));
      } else {
        io?.observe(el);
      }
    };

    const scan = () => {
      document.querySelectorAll('section').forEach((el) => {
        if (el.closest('header, footer')) return;
        observe(el);
      });
    };

    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) reveal(e.target);
      },
      { threshold: 0.05, rootMargin: '0px 0px -10% 0px' },
    );

    // Coalesce scans into a single rAF so frequent re-renders don't thrash.
    let scheduled = 0;
    const scheduleScan = () => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        scan();
      });
    };

    scheduleScan(); // initial pass after layout settles

    // Catch sections added later (e.g. live results appearing after a search).
    mo = new MutationObserver(scheduleScan);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (scheduled) cancelAnimationFrame(scheduled);
      io?.disconnect();
      mo?.disconnect();
    };
  }, [pathname]);

  return null;
}
