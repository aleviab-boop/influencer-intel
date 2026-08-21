import type { CSSProperties, ReactNode } from 'react';

// ============================================================
// Shared hand-drawn doodle set — the playful brand-book aesthetic first used on
// the Brand DNA card, extracted so it can decorate the whole site.
//   • DOODLE_SHAPES / DOODLE_HUES — the raw palette + shapes
//   • <Doodle> — one doodle as an inline SVG (float via className="ii-floatr")
//   • <DoodleField> — a fixed, non-interactive scatter layer dropped once in the
//     root layout so faint doodles float behind every page
// Motion uses the shared `.ii-floatr` class (globals.css), gated on
// prefers-reduced-motion.
// ============================================================

export const DOODLE_HUES = [
  '#6C4DF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EF4444', '#14B8A6', '#F97316',
];

// Each entry draws one doodle into a 0 0 24 24 viewBox, tinted with `c`.
export const DOODLE_SHAPES: ((c: string) => ReactNode)[] = [
  (c) => <path d="M12 2c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8z" fill={c} />,
  (c) => <path d="M12 3l2.6 5.5 5.9.6-4.4 4 1.2 5.9L12 21l-5.3 3 1.2-5.9-4.4-4 5.9-.6z" fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />,
  (c) => <path d="M2 13c2.5-4.5 4.5 3.5 7 0s4.5-4.5 7 0 4.5 3.5 6 0" fill="none" stroke={c} strokeWidth="1.9" strokeLinecap="round" />,
  (c) => <path d="M12 20s-6.8-4.3-8.7-8.6C2 8.5 4.2 6 7 6.9c1.6.5 2.4 1.9 3 2.9.6-1 1.4-2.4 3-2.9 2.8-.9 5 1.6 3.7 4.5C14.8 15.7 12 20 12 20z" fill="none" stroke={c} strokeWidth="1.6" />,
  (c) => <g stroke={c} strokeWidth="1.6" strokeLinecap="round" fill="none"><circle cx="12" cy="12" r="4" /><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" /></g>,
  (c) => <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />,
  (c) => <g fill="none" stroke={c} strokeWidth="1.5"><circle cx="12" cy="7" r="3" /><circle cx="7" cy="14" r="3" /><circle cx="17" cy="14" r="3" /><circle cx="12" cy="13" r="1.8" fill={c} /></g>,
  (c) => <path d="M4 16C8 8 13.5 6 19 7m0 0-4-2.2M19 7l-2.2 4.2" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  (c) => <path d="M12 4c5 0 8 3.2 8 8s-3 8-8 8-8-3-8-8c0-3.6 2.4-6.7 6-7.6" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" />,
];

export function Doodle({
  shape = 0,
  color,
  className = '',
  style,
}: {
  shape?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const c = color ?? DOODLE_HUES[shape % DOODLE_HUES.length]!;
  const render = DOODLE_SHAPES[shape % DOODLE_SHAPES.length]!;
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} style={style}>
      {render(c)}
    </svg>
  );
}

// Deterministic scatter (no Math.random, so SSR/CSR markup match). Positions are
// pushed toward the edges/corners so doodles frame the content instead of
// sitting behind body text.
const FIELD: {
  pos: CSSProperties;
  size: number;
  shape: number;
  hue: number;
  op: number;
  rot: string;
  delay: string;
}[] = [
  { pos: { top: '8%', left: '4%' }, size: 34, shape: 0, hue: 0, op: 0.5, rot: '10deg', delay: '0s' },
  { pos: { top: '18%', right: '6%' }, size: 26, shape: 1, hue: 1, op: 0.45, rot: '-8deg', delay: '1.1s' },
  { pos: { top: '42%', left: '3%' }, size: 30, shape: 2, hue: 5, op: 0.4, rot: '6deg', delay: '.6s' },
  { pos: { top: '55%', right: '4%' }, size: 40, shape: 6, hue: 3, op: 0.35, rot: '-12deg', delay: '1.8s' },
  { pos: { top: '72%', left: '6%' }, size: 28, shape: 3, hue: 6, op: 0.4, rot: '14deg', delay: '.9s' },
  { pos: { top: '85%', right: '8%' }, size: 32, shape: 7, hue: 2, op: 0.42, rot: '-6deg', delay: '2.4s' },
  { pos: { top: '30%', left: '48%' }, size: 22, shape: 4, hue: 4, op: 0.3, rot: '18deg', delay: '1.4s' },
  { pos: { top: '92%', left: '44%' }, size: 26, shape: 8, hue: 7, op: 0.32, rot: '-10deg', delay: '.3s' },
  { pos: { top: '5%', left: '60%' }, size: 24, shape: 5, hue: 8, op: 0.35, rot: '8deg', delay: '2s' },
];

export function DoodleField() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {FIELD.map((d, i) => (
        <Doodle
          key={i}
          shape={d.shape}
          color={DOODLE_HUES[d.hue]}
          className="ii-floatr absolute"
          style={{
            ...d.pos,
            width: d.size,
            height: d.size,
            opacity: d.op,
            ['--r' as string]: d.rot,
            animationDelay: d.delay,
          }}
        />
      ))}
    </div>
  );
}
