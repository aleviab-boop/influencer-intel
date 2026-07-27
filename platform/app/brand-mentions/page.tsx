'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT } from '@/components/marketing';

interface MatchedPost {
  caption?: string;
  post_url?: string;
  posted_at?: string;
  post_type?: string;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
}

interface Creator {
  id: string;
  handle: string;
  display_name: string | null;
  profile_photo_url: string | null;
  follower_count: number | string | null;
  primary_category: string | null;
  primary_city: string | null;
  primary_state: string | null;
  is_verified: boolean | null;
  engagement_rate: number | string | null;
  cred_score: string | null;
  vision_niche: string | null;
  paid_partner: boolean;
  matched_brand: string | null;
  mention_count: number;
  last_mention: string | null;
  matched_posts: MatchedPost[];
}

const fmt = (v: number | string | null | undefined): string => {
  const n = Number(v) || 0;
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
};
const erPct = (v: number | string | null): string => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  return (n * 100).toFixed(1) + '%';
};
const scoreColor = (s: string | null): string => {
  const n = Number(s);
  if (!Number.isFinite(n)) return '#9aa0ad';
  return n >= 80 ? '#10b981' : n >= 60 ? '#f59e0b' : '#f43f5e';
};
// Show the part of the caption AROUND the brand mention (captions are long and
// the mention is often buried), with the matched term highlighted.
function BrandSnippet({ caption, brand }: { caption: string | undefined; brand: string }) {
  if (!caption) return <span className="text-ink-400">(no caption)</span>;
  const lc = caption.toLowerCase();
  const i = lc.indexOf(brand.toLowerCase());
  if (i < 0) return <>{caption}</>;
  const start = Math.max(0, i - 70);
  const end = Math.min(caption.length, i + brand.length + 90);
  const pre = (start > 0 ? '…' : '') + caption.slice(start, i);
  const hit = caption.slice(i, i + brand.length);
  const post = caption.slice(i + brand.length, end) + (end < caption.length ? '…' : '');
  return (
    <>
      {pre}
      <mark className="bg-transparent font-semibold" style={{ color: ACCENT }}>{hit}</mark>
      {post}
    </>
  );
}

const timeAgo = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return '';
  const days = Math.floor((Date.now() - d) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

export default function BrandMentionsPage() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(() => {
    const company = debouncedQ.trim();
    if (company.length < 2) {
      setCreators([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    fetch(`/api/brand-mentions?company=${encodeURIComponent(company)}&limit=200`)
      .then((r) => r.json())
      .then((d) => setCreators(d.creators ?? []))
      .catch(() => setCreators([]))
      .finally(() => setLoading(false));
  }, [debouncedQ]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10">
        <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Brand Collaborations</div>
        <h1 className="text-2xl font-bold text-ink-900">Who&apos;s working with a brand</h1>
        <p className="text-[15px] text-ink-600 mt-1 mb-6">
          Type a company and see the creators who work with it — a detected paid partnership, a tagged collab, or a recent post about it shown as proof.
        </p>

        {/* Search */}
        <div className="rounded-2xl bg-white border border-border shadow-card p-3 flex items-center gap-2 mb-6">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              placeholder="Try a brand — Nykaa, Myntra, boAt, Mamaearth…"
              className="w-full pl-9 pr-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900"
            />
          </div>
          {searched && !loading && <div className="text-[13px] text-ink-500 pr-2 whitespace-nowrap">{creators.length} creator{creators.length === 1 ? '' : 's'}</div>}
        </div>

        {/* Results */}
        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !searched ? (
          <div className="text-sm text-ink-400 py-20 text-center rounded-2xl border border-dashed border-border bg-white">
            Start typing a company name to find the creators who&apos;ve posted about it.
          </div>
        ) : creators.length === 0 ? (
          <div className="text-sm text-ink-400 py-20 text-center rounded-2xl border border-dashed border-border bg-white">
            No creators in the database have posted about <span className="font-medium text-ink-600">{debouncedQ}</span> yet. Try another brand, or run more crawls to grow coverage.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {creators.map((c) => <CreatorRow key={c.id} c={c} brand={debouncedQ} />)}
          </div>
        )}
      </main>
    </div>
  );
}

function CreatorRow({ c, brand }: { c: Creator; brand: string }) {
  const top = c.matched_posts?.[0];
  const hasProof = c.mention_count > 0;
  return (
    <div className="group rounded-2xl bg-white border border-border shadow-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_36px_rgba(108,77,246,0.12)] hover:border-[#d9d3f7]">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <Avatar c={c} />
        <div className="min-w-0 flex-1">
          <Link href={`/insights/${encodeURIComponent(c.handle)}`} className="text-[15px] font-semibold text-ink-900 hover:underline flex items-center gap-1.5 truncate">
            <span className="truncate">{c.display_name || `@${c.handle}`}</span>
            {c.is_verified && <span title="Verified" className="shrink-0" style={{ color: ACCENT }}>✔</span>}
          </Link>
          <div className="text-[12px] text-ink-400 truncate">
            @{c.handle}
            {(c.primary_category || c.vision_niche) && <> · <span className="capitalize">{c.primary_category || c.vision_niche}</span></>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[15px] font-semibold text-ink-900 tabular-nums">{fmt(c.follower_count)}</div>
          <div className="text-[11px] text-ink-400">followers</div>
        </div>
      </div>

      {/* Relationship + secondary stats on one tidy line */}
      <div className="mt-3 flex items-center gap-2 flex-wrap text-[12px]">
        {hasProof ? (
          <span className="font-medium px-2 py-0.5 rounded-full text-white" style={{ background: ACCENT }}>
            {c.mention_count} post{c.mention_count === 1 ? '' : 's'}{c.last_mention ? ` · ${timeAgo(c.last_mention)}` : ''}
          </span>
        ) : (
          <span className="font-medium px-2 py-0.5 rounded-full border border-border text-ink-600">Works with {c.matched_brand || brand}</span>
        )}
        {c.paid_partner && (
          <span title="A paid-partnership tag was detected on this creator's profile" className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">Paid partner</span>
        )}
        <span className="ml-auto text-ink-400 tabular-nums whitespace-nowrap">
          ER {erPct(c.engagement_rate)} · <span className="font-medium" style={{ color: scoreColor(c.cred_score) }}>{c.cred_score ?? '—'}</span>
        </span>
      </div>

      {/* Evidence — only shown when there's an actual dated post about the brand */}
      {hasProof && top && (
        <div className="mt-2.5 rounded-xl bg-[#faf9ff] border border-border-soft px-3 py-2">
          <p className="text-[12.5px] text-ink-600 leading-snug line-clamp-2"><BrandSnippet caption={top.caption} brand={brand} /></p>
          {top.post_url && (
            <a href={top.post_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] font-medium hover:underline" style={{ color: ACCENT }} onClick={(e) => e.stopPropagation()}>
              View post →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ c }: { c: Creator }) {
  // Two-stage fallback: proxy the DB photo URL through /api/ig-image (IG CDN URLs
  // are hotlink-blocked cross-origin), then /api/ig-avatar by handle, then a
  // deterministic gradient initial. `stage` advances on each onError.
  const [stage, setStage] = useState(0);
  let h = 0;
  for (let i = 0; i < c.handle.length; i++) h = (h * 31 + c.handle.charCodeAt(i)) >>> 0;

  const src =
    stage === 0 && c.profile_photo_url
      ? `/api/ig-image?u=${encodeURIComponent(c.profile_photo_url)}`
      : stage <= 1
        ? `/api/ig-avatar?handle=${encodeURIComponent(c.handle)}`
        : null;

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={c.handle}
        onError={() => setStage((s) => (s === 0 && c.profile_photo_url ? 1 : 2))}
        className="w-11 h-11 rounded-full object-cover shrink-0 transition-transform duration-200 group-hover:scale-105"
      />
    );
  }
  return (
    <div className="w-11 h-11 rounded-full shrink-0 grid place-items-center text-white text-[15px] font-semibold transition-transform duration-200 group-hover:scale-105" style={{ background: `linear-gradient(135deg, hsl(${h % 360} 55% 62%), hsl(${(h + 50) % 360} 55% 50%))` }}>
      {(c.display_name || c.handle).charAt(0).toUpperCase()}
    </div>
  );
}
