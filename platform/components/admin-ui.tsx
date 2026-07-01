'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';

export const ACCENT = '#6C4DF6';
export const ACCENT_2 = '#9b7bff';

// A polling hook that accumulates a metric's value into a rolling series so a
// sparkline can visualise it updating live.
export function useTrend(value: number | undefined | null, len = 30): number[] {
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    if (value == null) return;
    setSeries((s) => (s.length && s[s.length - 1] === value ? s : [...s, value]).slice(-len));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return series;
}

// Animated area sparkline.
export function Sparkline({ data, color = ACCENT, height = 40 }: { data: number[]; color?: string; height?: number }) {
  const id = useId().replace(/:/g, '');
  if (!data || data.length < 2) return <div style={{ height }} />;
  const w = 140;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 6) - 3;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${height} L0,${height} Z`;
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 2px 4px ${color}33)` }} />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color}>
        <animate attributeName="r" values="3;5;3" dur="1.6s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

// Gradient stat card with hover lift + optional live sparkline.
export function StatCard({
  label,
  value,
  sub,
  icon,
  trend,
  color = ACCENT,
  accentTop = true,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  trend?: number[];
  color?: string;
  accentTop?: boolean;
}) {
  return (
    <div className="group relative rounded-2xl border border-[#ececf3] bg-white p-5 overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_50px_rgba(108,77,246,0.16)] hover:border-[#d9d2f7]">
      {accentTop && (
        <div className="absolute inset-x-0 top-0 h-1 opacity-70 group-hover:opacity-100 transition-opacity" style={{ background: `linear-gradient(90deg, ${color}, ${ACCENT_2})` }} />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11.5px] font-medium uppercase tracking-wide text-[#9aa]">{label}</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums leading-none" style={{ color: '#1a1a2e' }}>{value}</div>
          {sub && <div className="text-[12px] text-[#aab] mt-1.5">{sub}</div>}
        </div>
        {icon && (
          <span className="w-9 h-9 rounded-xl grid place-items-center text-white shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3" style={{ background: `linear-gradient(135deg, ${color}, ${ACCENT_2})`, boxShadow: `0 6px 16px ${color}44` }}>
            {icon}
          </span>
        )}
      </div>
      {trend && trend.length > 1 && (
        <div className="mt-3 -mb-1 -mx-1"><Sparkline data={trend} color={color} /></div>
      )}
    </div>
  );
}

// Section header with a soft gradient wash.
export function PageHeader({ title, subtitle, badge }: { title: string; subtitle?: string; badge?: ReactNode }) {
  return (
    <div className="relative mb-7 rounded-2xl overflow-hidden border border-[#ececf3] px-6 py-5" style={{ background: 'linear-gradient(120deg, #ffffff 0%, #f7f5ff 55%, #f2ecff 100%)' }}>
      <div className="absolute -right-10 -top-16 w-56 h-56 rounded-full opacity-[0.14]" style={{ background: `radial-gradient(circle, ${ACCENT}, transparent 70%)` }} />
      <div className="relative flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {badge}
      </div>
      {subtitle && <p className="relative mt-1 text-[14px] text-[#777] max-w-2xl">{subtitle}</p>}
    </div>
  );
}

export function LiveBadge({ live, label }: { live?: boolean; label?: [string, string] }) {
  const [on, off] = label ?? ['Live', 'Idle'];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
      style={live
        ? { background: '#ecfdf5', color: '#059669', borderColor: '#a7f3d0' }
        : { background: '#f4f4f6', color: '#888', borderColor: '#e5e5ea' }}
    >
      <span className={`w-2 h-2 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-[#bbb]'}`} />
      {live ? on : off}
    </span>
  );
}
