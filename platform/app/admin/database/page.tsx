'use client';

import { useEffect, useState, useCallback } from 'react';

const ACCENT = '#6C4DF6';

interface TableInfo {
  name: string;
  est_rows: number;
  col_count: number;
}
interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  redacted: boolean;
}
interface TableDetail {
  table: string;
  row_count: number;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

// Render any cell value compactly: objects/arrays → truncated JSON, long strings
// → truncated, null → a muted dash.
function cell(v: unknown): { text: string; muted: boolean } {
  if (v === null || v === undefined) return { text: '—', muted: true };
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return { text: s.length > 120 ? s.slice(0, 120) + '…' : s, muted: false };
  }
  const s = String(v);
  return { text: s.length > 120 ? s.slice(0, 120) + '…' : s, muted: false };
}

export default function DatabasePage() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'rows' | 'schema'>('rows');

  useEffect(() => {
    (async () => {
      try {
        const d = await fetch('/api/admin/db', { cache: 'no-store' }).then((r) => r.json());
        if (d.error) throw new Error(d.error);
        setTables(d.tables ?? []);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoadingList(false);
      }
    })();
  }, []);

  const openTable = useCallback(async (name: string) => {
    setActive(name);
    setDetail(null);
    setLoadingDetail(true);
    setErr(null);
    try {
      const d = await fetch(`/api/admin/db?table=${encodeURIComponent(name)}`, { cache: 'no-store' }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setDetail(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold tracking-tight">Database</h1>
        <p className="text-[13px] text-[#888] mt-1">
          Read-only view of the live Postgres. Every base table, its schema, and up to 50 sample rows.
          Sensitive columns (passwords, tokens, hashes) are masked.
        </p>
      </div>

      <div className="flex gap-6">
        {/* table list */}
        <aside className="w-64 shrink-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#aab] mb-2 px-1">
            Tables {tables.length > 0 && <span className="text-[#ccc]">· {tables.length}</span>}
          </div>
          {loadingList ? (
            <div className="text-[13px] text-[#999] px-1">Loading…</div>
          ) : (
            <div className="space-y-0.5">
              {tables.map((t) => (
                <button
                  key={t.name}
                  onClick={() => void openTable(t.name)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-all ${
                    active === t.name ? 'text-white' : 'hover:bg-[#f5f3ff] text-[#333]'
                  }`}
                  style={active === t.name ? { background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` } : undefined}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium truncate">{t.name}</span>
                    <span className={`text-[11px] tabular-nums ${active === t.name ? 'text-white/80' : 'text-[#aaa]'}`}>
                      {fmtNum(t.est_rows)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* detail */}
        <section className="flex-1 min-w-0">
          {!active && !err && (
            <div className="rounded-2xl border border-[#ececf3] bg-white p-10 text-center text-[#999] text-[14px]">
              Select a table on the left to inspect its schema and rows.
            </div>
          )}
          {err && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-700">{err}</div>
          )}
          {active && !err && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-[18px] font-bold">{active}</h2>
                  {detail && (
                    <p className="text-[12px] text-[#888]">
                      {fmtNum(detail.row_count)} rows · {detail.columns.length} columns
                      {detail.row_count > detail.rows.length && ` · showing first ${detail.rows.length}`}
                    </p>
                  )}
                </div>
                <div className="flex rounded-lg border border-[#e3def9] overflow-hidden text-[12px] font-semibold">
                  {(['rows', 'schema'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`px-3 py-1.5 ${view === v ? 'text-white' : 'text-[#666] hover:bg-[#faf9ff]'}`}
                      style={view === v ? { background: ACCENT } : undefined}
                    >
                      {v === 'rows' ? 'Rows' : 'Schema'}
                    </button>
                  ))}
                </div>
              </div>

              {loadingDetail ? (
                <div className="text-[13px] text-[#999]">Loading…</div>
              ) : detail && view === 'schema' ? (
                <div className="rounded-2xl border border-[#ececf3] bg-white overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead className="bg-[#faf9ff] text-[#888] text-[11px] uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold">Column</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Type</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Nullable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.columns.map((c) => (
                        <tr key={c.name} className="border-t border-[#f1f1f6]">
                          <td className="px-4 py-2 font-medium text-[#222]">
                            {c.name}
                            {c.redacted && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">masked</span>}
                          </td>
                          <td className="px-4 py-2 text-[#6C4DF6] font-mono text-[12px]">{c.type}</td>
                          <td className="px-4 py-2 text-[#999]">{c.nullable ? 'yes' : 'no'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : detail && view === 'rows' ? (
                detail.rows.length === 0 ? (
                  <div className="rounded-2xl border border-[#ececf3] bg-white p-8 text-center text-[#999] text-[14px]">
                    No rows in this table.
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[#ececf3] bg-white overflow-auto max-h-[70vh]">
                    <table className="text-[12px] min-w-full">
                      <thead className="bg-[#faf9ff] text-[#888] text-[11px] uppercase tracking-wide sticky top-0">
                        <tr>
                          {detail.columns.map((c) => (
                            <th key={c.name} className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">{c.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.rows.map((row, i) => (
                          <tr key={i} className="border-t border-[#f1f1f6] hover:bg-[#faf9ff]">
                            {detail.columns.map((c) => {
                              const { text, muted } = cell(row[c.name]);
                              return (
                                <td key={c.name} className={`px-3 py-2 whitespace-nowrap max-w-[280px] truncate ${muted ? 'text-[#ccc]' : 'text-[#333]'}`} title={muted ? '' : text}>
                                  {text}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
