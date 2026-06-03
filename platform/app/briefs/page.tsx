'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';

interface BriefRow {
  id: string;
  status: string;
  raw_text: string;
  category: string | null;
  campaign_type: string | null;
  created_at: string;
  creator_count: number;
  pending_count: number;
}

interface ImportCreator {
  handle: string;
  display_name: string | null;
  follower_count: number | null;
  engagement_rate: number | null;
  primary_category: string | null;
  primary_city: string | null;
  credibility_score: number | null;
  match_score?: number;
  profile_photo_url: string | null;
  is_verified: boolean;
  signals: string[];
}

interface ImportResult {
  total_uploaded: number;
  found: number;
  not_found: string[];
  creators: ImportCreator[];
  brief_id?: string;
}

export default function BriefsPage() {
  const router = useRouter();
  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
  const [newBrief, setNewBrief] = useState('');
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBriefText, setImportBriefText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showNotFound, setShowNotFound] = useState(false);

  useEffect(() => {
    fetch('/api/briefs-list')
      .then((r) => r.json())
      .then((d) => setBriefs(d.briefs ?? []))
      .catch(() => {});
  }, []);

  async function createBrief() {
    if (newBrief.trim().length < 10 || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: newBrief.trim() }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      router.push(`/shortlist/${data.brief_id}`);
    } catch {
      setCreating(false);
    }
  }

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.csv'))) {
      setImportFile(f);
      setImportError(null);
    } else {
      setImportError('Only .xlsx and .csv files are supported');
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setImportFile(f);
      setImportError(null);
    }
  }, []);

  async function runImport() {
    if (!importFile || importing) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);

    const fd = new FormData();
    fd.append('file', importFile);
    if (importBriefText.trim().length >= 10) {
      fd.append('brief_text', importBriefText.trim());
    }

    try {
      const res = await fetch('/api/briefs/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? 'Import failed');
        setImporting(false);
        return;
      }
      const result = data as ImportResult;
      if (result.brief_id) {
        router.push(`/shortlist/${result.brief_id}`);
        return;
      }
      setImportResult(result);
    } catch {
      setImportError('Network error — please try again');
    }
    setImporting(false);
  }

  const filtered = useMemo(() => {
    return briefs.filter((b) => {
      if (filter === 'active' && b.pending_count === 0) return false;
      if (filter === 'done' && b.pending_count > 0) return false;
      if (q.trim()) {
        const hay = `${b.raw_text} ${b.category ?? ''} ${b.campaign_type ?? ''}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [briefs, q, filter]);

  return (
    <main className="min-h-screen bg-white">
      <AppHeader />

      <section className="max-w-6xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-light text-[#111]">Briefs</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowImport((v) => !v); if (showNew) setShowNew(false); }}
              className="px-4 py-2 border border-[#e5e5e5] text-[#111] text-[13px] tracking-wide hover:border-[#111] transition-colors"
            >
              {showImport ? 'Cancel' : 'Import List'}
            </button>
            <button
              onClick={() => { setShowNew((v) => !v); if (showImport) setShowImport(false); }}
              className="px-4 py-2 bg-[#111] text-white text-[13px] tracking-wide hover:bg-[#333] transition-colors"
            >
              {showNew ? 'Cancel' : 'New Brief'}
            </button>
          </div>
        </div>
        <p className="text-[13px] text-[#999]">{briefs.length} total</p>
      </section>

      {showNew && (
        <section className="max-w-6xl mx-auto px-6 pb-6">
          <div className="border border-[#e5e5e5] p-5">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-3">Describe your campaign</div>
            <textarea
              value={newBrief}
              onChange={(e) => setNewBrief(e.target.value)}
              rows={4}
              placeholder="e.g. Festive Diwali campaign for our ghee skincare line — ₹8L budget, target metro women 25-34, prefer creators with past festive content and 85%+ credibility."
              className="w-full px-4 py-3 border border-[#e5e5e5] text-[14px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#111] transition-colors resize-none mb-3"
              disabled={creating}
            />
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[#ccc]">
                {newBrief.trim().length < 10 ? `${10 - newBrief.trim().length} more chars needed` : 'Ready'}
              </span>
              <button
                onClick={createBrief}
                disabled={creating || newBrief.trim().length < 10}
                className="px-5 py-2 bg-[#111] text-white text-[13px] tracking-wide hover:bg-[#333] disabled:opacity-20 transition-all"
              >
                {creating ? 'Researching...' : 'Research & Shortlist'}
              </button>
            </div>
          </div>
        </section>
      )}

      {showImport && (
        <section className="max-w-6xl mx-auto px-6 pb-6">
          <div className="border border-[#e5e5e5] p-5">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-4">
              Import influencer list
            </div>

            {/* Drop zone */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={handleFileSelect}
            />
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-sm px-6 py-8 text-center cursor-pointer transition-colors mb-4 ${
                dragOver
                  ? 'border-[#111] bg-[#fafafa]'
                  : importFile
                    ? 'border-[#111] bg-[#fafafa]'
                    : 'border-[#e5e5e5] hover:border-[#999]'
              }`}
            >
              {importFile ? (
                <div>
                  <span className="text-[14px] text-[#111]">{importFile.name}</span>
                  <span className="text-[12px] text-[#999] ml-2">
                    ({(importFile.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
              ) : (
                <div>
                  <p className="text-[14px] text-[#999]">
                    Drop Excel/CSV or click to upload
                  </p>
                  <p className="text-[11px] text-[#ccc] mt-1">
                    Supported: .xlsx, .csv
                  </p>
                </div>
              )}
            </div>

            {/* Optional brief text */}
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-2">
              Optional: describe your campaign for auto-ranking
            </div>
            <textarea
              value={importBriefText}
              onChange={(e) => setImportBriefText(e.target.value)}
              rows={3}
              placeholder="e.g. Summer skincare campaign for metro women 25-34, prefer beauty/skincare creators with 85%+ credibility"
              className="w-full px-4 py-3 border border-[#e5e5e5] text-[14px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#111] transition-colors resize-none mb-4"
              disabled={importing}
            />

            {importError && (
              <div className="text-[13px] text-red-600 mb-3">{importError}</div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[#ccc]">
                {!importFile
                  ? 'Select a file to begin'
                  : importBriefText.trim().length >= 10
                    ? 'Will rank & create brief'
                    : 'Will return enriched list'}
              </span>
              <button
                onClick={runImport}
                disabled={!importFile || importing}
                className="px-5 py-2 bg-[#111] text-white text-[13px] tracking-wide hover:bg-[#333] disabled:opacity-20 transition-all"
              >
                {importing ? 'Analyzing...' : 'Import & Analyze'}
              </button>
            </div>
          </div>

          {/* Import results (no brief text case — inline table) */}
          {importResult && (
            <div className="border border-[#e5e5e5] mt-4 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-[14px] text-[#111] font-medium">
                    {importResult.found} of {importResult.total_uploaded} creators found
                  </span>
                </div>
                {importResult.not_found.length > 0 && (
                  <button
                    onClick={() => setShowNotFound((v) => !v)}
                    className="text-[12px] text-[#999] hover:text-[#111] transition-colors"
                  >
                    {showNotFound ? 'Hide' : 'Show'} {importResult.not_found.length} not found
                  </button>
                )}
              </div>

              {/* Not found handles (collapsible) */}
              {showNotFound && importResult.not_found.length > 0 && (
                <div className="mb-4 p-3 bg-[#fafafa] border border-[#e5e5e5]">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-2">
                    Not found in database
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {importResult.not_found.map((h) => (
                      <span
                        key={h}
                        className="px-2 py-0.5 text-[12px] text-[#999] bg-white border border-[#e5e5e5] rounded-sm"
                      >
                        @{h}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Results table */}
              {importResult.creators.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-[#e5e5e5]">
                        <th className="text-left py-2 pr-4 text-[11px] uppercase tracking-[0.12em] text-[#999] font-normal">Handle</th>
                        <th className="text-left py-2 pr-4 text-[11px] uppercase tracking-[0.12em] text-[#999] font-normal">Name</th>
                        <th className="text-right py-2 pr-4 text-[11px] uppercase tracking-[0.12em] text-[#999] font-normal">Followers</th>
                        <th className="text-left py-2 pr-4 text-[11px] uppercase tracking-[0.12em] text-[#999] font-normal">Category</th>
                        <th className="text-left py-2 pr-4 text-[11px] uppercase tracking-[0.12em] text-[#999] font-normal">City</th>
                        <th className="text-right py-2 pr-4 text-[11px] uppercase tracking-[0.12em] text-[#999] font-normal">Credibility</th>
                        {importResult.creators[0]?.match_score !== undefined && (
                          <th className="text-right py-2 pr-4 text-[11px] uppercase tracking-[0.12em] text-[#999] font-normal">Match</th>
                        )}
                        <th className="text-left py-2 text-[11px] uppercase tracking-[0.12em] text-[#999] font-normal">Signals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.creators.map((c) => (
                        <tr key={c.handle} className="border-b border-[#f0f0f0] hover:bg-[#fafafa]">
                          <td className="py-2.5 pr-4 text-[#111]">
                            <div className="flex items-center gap-1.5">
                              @{c.handle}
                              {c.is_verified && (
                                <span className="w-3.5 h-3.5 rounded-full bg-blue-500 text-white text-[9px] flex items-center justify-center shrink-0" title="Verified">
                                  &#10003;
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 text-[#666]">{c.display_name ?? '—'}</td>
                          <td className="py-2.5 pr-4 text-right text-[#111] tabular-nums">
                            {c.follower_count !== null ? formatNum(c.follower_count) : '—'}
                          </td>
                          <td className="py-2.5 pr-4 text-[#666]">{c.primary_category ?? '—'}</td>
                          <td className="py-2.5 pr-4 text-[#666]">{c.primary_city ?? '—'}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">
                            {c.credibility_score !== null ? `${c.credibility_score}%` : '—'}
                          </td>
                          {c.match_score !== undefined && (
                            <td className="py-2.5 pr-4 text-right tabular-nums font-medium text-[#111]">
                              {c.match_score}%
                            </td>
                          )}
                          <td className="py-2.5 text-[12px] text-[#999]">
                            {c.signals.slice(0, 3).join(' · ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="max-w-6xl mx-auto px-6 pb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search brief text, category, campaign…"
            className="flex-1 min-w-[280px] px-4 py-2.5 rounded-[10px] bg-surface border border-border text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-ink-400"
          />
          <FilterTab active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterTab>
          <FilterTab active={filter === 'active'} onClick={() => setFilter('active')}>
            Researching
          </FilterTab>
          <FilterTab active={filter === 'done'} onClick={() => setFilter('done')}>
            Done
          </FilterTab>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16">
        {filtered.length === 0 ? (
          <div className="rounded-[14px] border border-border bg-surface p-10 text-center text-ink-600">
            No briefs match.
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((b) => (
              <Row key={b.id} brief={b} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-[10px] text-sm transition-colors ${
        active ? 'bg-ink-900 text-white' : 'bg-surface border border-border text-ink-600 hover:text-ink-900'
      }`}
    >
      {children}
    </button>
  );
}

function Row({ brief }: { brief: BriefRow }) {
  const date = new Date(brief.created_at);
  return (
    <Link
      href={`/shortlist/${brief.id}`}
      className="block rounded-[12px] border border-border bg-surface px-5 py-4 hover:border-ink-300 transition-colors"
    >
      <div className="flex items-start gap-4">
        <Dot status={brief.status} pending={brief.pending_count} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-ink-900 leading-relaxed line-clamp-2">{brief.raw_text}</p>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px] text-ink-600">
            {brief.category && <Pill>{brief.category}</Pill>}
            {brief.campaign_type && <Pill>{brief.campaign_type}</Pill>}
            <Pill>
              {brief.creator_count} creators{brief.pending_count > 0 ? ` · ${brief.pending_count} pending` : ''}
            </Pill>
            <span className="text-ink-400 ml-1 tabular-nums">{date.toLocaleString()}</span>
          </div>
        </div>
        <span className="text-ink-400 text-sm pt-1">→</span>
      </div>
    </Link>
  );
}

function Dot({ status, pending }: { status: string; pending: number }) {
  if (pending > 0) {
    return <span className="w-2 h-2 rounded-full bg-warn animate-pulse mt-2 shrink-0" />;
  }
  if (status === 'shortlisted') {
    return <span className="w-2 h-2 rounded-full bg-success mt-2 shrink-0" />;
  }
  return <span className="w-2 h-2 rounded-full bg-ink-300 mt-2 shrink-0" />;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-canvas border border-border">
      {children}
    </span>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
