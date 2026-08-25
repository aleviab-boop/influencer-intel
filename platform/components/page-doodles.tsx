import type { CSSProperties } from 'react';
import { Doodle, DOODLE_HUES } from './doodles';

// A reusable scatter of floating hand-drawn doodles for marketing / feature
// hero sections. The global <DoodleField> (fixed, -z-10) is hidden on these
// pages because each hero paints an OPAQUE gradient over it — so drop this
// inside a hero instead. Requirements on the host section:
//   • add `relative isolate` (isolate makes the section its own stacking
//     context, so this -z-10 layer paints ABOVE the section's gradient
//     background but BELOW the in-flow content — no content edits needed).
//   • `overflow-hidden` if you don't want edge doodles to bleed out.
// Motion via .ii-floatr, auto-disabled under prefers-reduced-motion.
const SCATTER: { pos: CSSProperties; size: number; shape: number; hue: number; op: number; rot: string; delay: string }[] = [
  { pos: { top: '9%', left: '5%' }, size: 44, shape: 0, hue: 0, op: 0.5, rot: '-12deg', delay: '0s' },
  { pos: { top: '30%', left: '10%' }, size: 28, shape: 4, hue: 4, op: 0.4, rot: '10deg', delay: '1.1s' },
  { pos: { bottom: '14%', left: '7%' }, size: 38, shape: 6, hue: 3, op: 0.42, rot: '8deg', delay: '.6s' },
  { pos: { top: '11%', right: '6%' }, size: 40, shape: 2, hue: 5, op: 0.45, rot: '-8deg', delay: '1.8s' },
  { pos: { top: '32%', right: '9%' }, size: 26, shape: 5, hue: 8, op: 0.38, rot: '6deg', delay: '2.2s' },
  { pos: { bottom: '16%', right: '7%' }, size: 42, shape: 7, hue: 6, op: 0.4, rot: '14deg', delay: '.9s' },
];

// The caller controls stacking via `className`:
//   • bg painted on the <section> itself → mark the section `relative isolate`
//     and pass `-z-10` (doodles sit above the section bg, below content).
//   • bg painted by overlay <div>s → drop this (no z class) right before the
//     content container so it paints above the overlays, below the content.
export function PageDoodles({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {SCATTER.map((d, i) => (
        <Doodle
          key={i}
          shape={d.shape}
          color={DOODLE_HUES[d.hue]}
          className="ii-floatr absolute"
          style={{ ...d.pos, width: d.size, height: d.size, opacity: d.op, ['--r' as string]: d.rot, animationDelay: d.delay }}
        />
      ))}
    </div>
  );
}
