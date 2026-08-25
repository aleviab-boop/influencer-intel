'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader, LiveBadge } from '@/components/admin-ui';
import { PageDoodles } from '@/components/page-doodles';

interface Cell { niche: string; count: number }
interface Row { city: string; total: number; cells: Cell[] }
interface Coverage {
  niches: Array<{ key: string; label: string }>;
  cities: string[];
  matrix: Row[];
  nicheTotals: Cell[];
  grandTotal: number;
}

// Heat color: gaps (0) read as a soft red "to crawl", then green deepens with
// coverage so the eye lands on what's missing.
function heat(n: number): { bg: string; fg: string } {
  if (n === 0) return { bg: '#fff1f2', fg: '#e11d48' };
  if (n < 5) return { bg: '#fef3c7', fg: '#92400e' };
  if (n < 15) return { bg: '#ecfccb', fg: '#3f6212' };
  if (n < 40) return { bg: '#d9f99d', fg: '#365314' };
  if (n < 100) return { bg: '#86efac', fg: '#14532d' };
  return { bg: '#4ade80', fg: '#052e16' };
}

export default function CoveragePage() {
  const [data, setData] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/coverage')
      .then((r) => r.json())
      .then((d) => { if (alive) { setData(d as Coverage); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="relative isolate overflow-hidden px-8 py-7">
      <PageDoodles className="-z-10" />
      <PageHeader
        title="Coverage"
        subtitle="Creators in the database by niche and city. Red cells are gaps — crawl those next."
        badge={<LiveBadge live={!!data} label={['Loaded', 'Loading']} />}
      />

      {loading && <div className="text-[14px] text-[#888]">Loading coverage…</div>}

      {data && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-4 text-[13px] text-[#666]">
            <span><span className="font-semibold text-[#111]">{data.grandTotal.toLocaleString()}</span> creators across {data.cities.length} cities × {data.niches.length} niches</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#fff1f2', border: '1px solid #fecdd3' }} /> gap</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#4ade80' }} /> well covered</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#ececf3] bg-white shadow-[0_10px_40px_rgba(108,77,246,0.06)]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#faf9ff]">
                  <th className="sticky left-0 z-10 bg-[#faf9ff] px-3 py-3 text-left font-semibold text-[#555] border-b border-[#f0f0f5]">City</th>
                  {data.niches.map((n) => (
                    <th key={n.key} className="px-2 py-3 text-center font-medium text-[#777] border-b border-[#f0f0f5] whitespace-nowrap">{n.label}</th>
                  ))}
                  <th className="px-3 py-3 text-center font-semibold text-[#555] border-b border-[#f0f0f5]">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.matrix.map((row) => (
                  <tr key={row.city} className="border-b border-[#f6f6fa]">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2.5 font-medium text-[#111] whitespace-nowrap">{row.city}</td>
                    {row.cells.map((c) => {
                      const h = heat(c.count);
                      return (
                        <td key={c.niche} className="px-1.5 py-1.5 text-center">
                          <Link
                            href={`/admin/scraper?prefill=${encodeURIComponent(`${c.niche} creator in ${row.city}`)}`}
                            className="block rounded-lg py-1.5 font-semibold transition-transform hover:scale-105"
                            style={{ background: h.bg, color: h.fg }}
                            title={c.count === 0 ? `No ${c.niche} creators in ${row.city} — click to crawl` : `${c.count} ${c.niche} creators in ${row.city}`}
                          >
                            {c.count}
                          </Link>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center font-semibold text-[#111]">{row.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#faf9ff]">
                  <td className="sticky left-0 z-10 bg-[#faf9ff] px-3 py-2.5 font-semibold text-[#555]">Total</td>
                  {data.nicheTotals.map((c) => (
                    <td key={c.niche} className="px-2 py-2.5 text-center font-semibold text-[#555]">{c.count.toLocaleString()}</td>
                  ))}
                  <td className="px-3 py-2.5 text-center font-semibold text-[#111]">{data.grandTotal.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-3 text-[12px] text-[#999]">Tip: click any cell to jump to the Scraper with that niche + city pre-filled.</p>
        </>
      )}
    </div>
  );
}
