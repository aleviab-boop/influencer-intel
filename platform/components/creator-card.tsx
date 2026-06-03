'use client';

import { useState } from 'react';
import type { ShortlistCreatorView } from '@influencer-intel/shared/types';

export function CreatorCard({ creator }: { creator: ShortlistCreatorView }) {
  const c = creator.creator;
  const [open, setOpen] = useState(false);
  const reasoningSummary = previewReasoning(creator.reasoning);

  return (
    <article className="group rounded-[10px] bg-canvas border border-border hover:border-ink-900/30 hover:shadow-card transition-all">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full grid grid-cols-[28px_44px_1fr_auto_auto_auto_16px] items-center gap-4 px-4 py-3.5 text-left"
      >
        <span className="text-sm text-ink-400 font-mono tabular-nums shrink-0 text-center">
          {creator.rank}
        </span>

        <Avatar handle={c.handle} src={c.profile_photo_url} />

        <div className="min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <a
              href={`https://www.instagram.com/${c.handle}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-ink-900 hover:text-ink-600 truncate"
              onClick={(e) => e.stopPropagation()}
            >
              @{c.handle}
            </a>
            {c.is_verified && <VerifiedDot />}
            {c.display_name && (
              <span className="text-sm text-ink-600 truncate hidden md:inline">· {c.display_name}</span>
            )}
            <FreshnessDot freshness={creator.freshness} />
          </div>
          {(reasoningSummary || hasMetadata(creator)) && (
            <div className="mt-1 flex items-center gap-3 text-sm text-ink-600 min-w-0">
              {hasMetadata(creator) && (
                <div className="flex items-center gap-2.5 shrink-0">
                  <Stat value={c.primary_city} />
                  <Stat value={c.follower_count !== null ? formatFollowers(c.follower_count) + ' followers' : null} />
                  <Stat value={c.engagement_rate !== null ? `${(c.engagement_rate * 100).toFixed(1)}% ER` : null} />
                  <Stat value={tierLabel(creator.raw_metadata?.tier)} />
                </div>
              )}
              {reasoningSummary && (
                <span className="truncate text-ink-600/80">{reasoningSummary}</span>
              )}
            </div>
          )}
        </div>

        {creator.audience?.gender_female_pct !== null && creator.audience?.gender_female_pct !== undefined && (
          <div className="text-right text-sm hidden xl:block shrink-0">
            <div className="text-ink-900 tabular-nums">{Math.round(creator.audience.gender_female_pct)}% F</div>
            <div className="text-[11px] uppercase tracking-wider text-ink-400">{creator.audience.confidence}</div>
          </div>
        )}

        {creator.credibility && (
          <CredibilityChip score={creator.credibility.overall_score} badge={creator.credibility.badge} />
        )}

        <div className="text-right shrink-0">
          <div className="text-xl font-semibold tabular-nums text-ink-900 leading-none">
            {creator.match_score}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-1">Match</div>
        </div>

        <Chevron open={open} />
      </button>

      {open && <ExpandedPanel creator={creator} />}
    </article>
  );
}

function ExpandedPanel({ creator }: { creator: ShortlistCreatorView }) {
  const c = creator.creator;
  const meta = creator.raw_metadata;
  const vision = meta?.vision;

  return (
    <div className="border-t border-border-soft px-5 py-5 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      <div className="space-y-6 min-w-0">
        {creator.reasoning && (
          <Section title="Why ranked">
            <div className="text-sm text-ink-900 whitespace-pre-line leading-relaxed">
              {creator.reasoning}
            </div>
          </Section>
        )}

        {(c.bio || vision?.bio_text) && (
          <Section title="Bio">
            <p className="text-sm text-ink-900 leading-relaxed whitespace-pre-line">
              {c.bio ?? vision?.bio_text}
            </p>
            {meta?.external_link && (
              <a
                href={meta.external_link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm text-lilac hover:underline truncate max-w-full"
              >
                {meta.external_link} ↗
              </a>
            )}
          </Section>
        )}

        <Section title="Reach & activity">
          {(() => {
            const geo = (meta as unknown as { geo?: {
              avg_likes?: number | null;
              avg_comments?: number | null;
              avg_views?: number | null;
              engagement_rate?: number | null;
              posts_per_week?: number | null;
              last_post_at?: string | null;
              top_hashtags?: Array<{ tag: string; count: number }>;
              brand_mentions?: string[];
            } } | undefined)?.geo;
            return (
              <>
                <Grid>
                  <KV k="Followers" v={fmt(c.follower_count)} />
                  <KV k="Following" v={fmt(c.following_count)} />
                  <KV k="Posts" v={fmt(c.posts_count)} />
                  <KV
                    k="Engagement rate"
                    v={
                      geo?.engagement_rate != null
                        ? `${geo.engagement_rate.toFixed(2)}%`
                        : c.engagement_rate !== null
                        ? `${(c.engagement_rate * 100).toFixed(2)}%`
                        : '—'
                    }
                  />
                  <KV k="Avg likes" v={geo?.avg_likes != null ? fmt(geo.avg_likes) : '—'} />
                  <KV k="Avg comments" v={geo?.avg_comments != null ? fmt(geo.avg_comments) : '—'} />
                  <KV k="Avg views" v={geo?.avg_views != null ? fmt(geo.avg_views) : '—'} />
                  <KV k="Posts / week" v={geo?.posts_per_week != null ? geo.posts_per_week.toFixed(1) : '—'} />
                  <KV
                    k="Last post"
                    v={geo?.last_post_at ? relativeDays(geo.last_post_at) : '—'}
                  />
                  <KV k="Follower / following" v={meta?.follower_to_following_ratio?.toFixed(1) ?? '—'} />
                  <KV k="Tier" v={tierLabel(meta?.tier) ?? c.data_tier?.toUpperCase()} />
                  <KV k="Highlights" v={meta?.highlights_count?.toString() ?? '—'} />
                  <KV k="Reels in grid" v={meta?.reel_count_in_grid?.toString() ?? '—'} />
                  <KV k="Posts in grid" v={meta?.post_count_in_grid?.toString() ?? '—'} />
                  <KV k="Verified" v={c.is_verified ? 'Yes' : 'No'} />
                  <KV k="Account type" v={meta?.account_type ?? '—'} />
                  <KV k="Engagement quality (vision)" v={vision?.engagement_quality_signal ?? '—'} />
                </Grid>
                {geo?.top_hashtags?.length ? (
                  <div className="mt-3">
                    <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1.5">Top hashtags</div>
                    <div className="flex flex-wrap gap-1.5">
                      {geo.top_hashtags.slice(0, 10).map((t) => (
                        <span
                          key={t.tag}
                          className="px-2 py-0.5 rounded-full bg-canvas border border-border text-[12px] text-ink-700"
                        >
                          #{t.tag} <span className="text-ink-400 tabular-nums">·{t.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {geo?.brand_mentions?.length ? (
                  <div className="mt-3">
                    <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1.5">Mentioned in posts</div>
                    <div className="flex flex-wrap gap-1.5">
                      {geo.brand_mentions.slice(0, 10).map((m) => (
                        <span
                          key={m}
                          className="px-2 py-0.5 rounded-full bg-canvas border border-border text-[12px] text-ink-700"
                        >
                          @{m}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            );
          })()}
        </Section>

        <Section title="Audience">
          <Grid>
            <KV k="Female %" v={creator.audience?.gender_female_pct !== null && creator.audience?.gender_female_pct !== undefined ? `${Math.round(creator.audience.gender_female_pct)}%` : '—'} />
            <KV k="Audience confidence" v={creator.audience?.confidence ?? '—'} />
            <KV k="Inferred audience age" v={vision?.estimated_audience_age_band ?? '—'} />
            <KV k="Gender skew (vision)" v={vision?.estimated_audience_gender_skew ?? '—'} />
            <KV k="India signal" v={meta?.is_indian_inferred ? 'Yes' : (vision?.india_signal ? 'Yes' : '—')} />
            <KV k="Operating language" v={(c.content_languages?.[0] ?? meta?.language_inferred ?? '—').toString().toUpperCase()} />
            <KV k="Vision languages" v={vision?.language_signal?.join(', ') ?? '—'} />
            <KV k="Primary city" v={c.primary_city ?? '—'} />
          </Grid>
          {creator.audience?.top_cities && creator.audience.top_cities.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1.5">
                Follower catchment (sampled)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {creator.audience.top_cities.slice(0, 8).map((tc) => (
                  <span
                    key={tc.city}
                    className="px-2 py-0.5 rounded-full bg-canvas border border-border text-[12px] text-ink-700 tabular-nums"
                  >
                    {tc.city} <span className="text-ink-400">{tc.pct}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {(() => {
            const geo = (meta as unknown as { geo?: { top_cities?: Array<{ name: string; count: number }>; posts_with_location?: number; posts_sampled?: number } } | undefined)?.geo;
            if (!geo?.top_cities?.length) return null;
            return (
              <div className="mt-3">
                <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1.5">
                  Where they post from (geo-tagged)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {geo.top_cities.slice(0, 5).map((tc) => (
                    <span
                      key={tc.name}
                      className="px-2 py-0.5 rounded-full bg-canvas border border-border text-[12px] text-ink-700"
                    >
                      {tc.name} <span className="text-ink-400 tabular-nums">·{tc.count}</span>
                    </span>
                  ))}
                  <span className="text-[11px] text-ink-400 self-center">
                    {geo.posts_with_location}/{geo.posts_sampled} posts tagged
                  </span>
                </div>
              </div>
            );
          })()}
        </Section>

        {(vision?.niche || vision?.sub_niches?.length || vision?.content_themes?.length || vision?.vibe_tags?.length || vision?.post_types_visible?.length) && (
          <Section title="Content & vibe">
            <Grid>
              <KV k="Niche" v={vision?.niche ?? c.primary_category ?? '—'} />
              <KV k="Sub-niches" v={vision?.sub_niches?.join(', ') || '—'} />
              <KV k="Content themes" v={vision?.content_themes?.join(', ') || '—'} />
              <KV k="Vibe" v={vision?.vibe_tags?.join(', ') || '—'} />
              <KV k="Post types" v={vision?.post_types_visible?.join(', ') || '—'} />
              <KV k="Visible posts" v={vision?.visible_post_count?.toString() ?? '—'} />
              <KV k="Visual quality" v={vision?.visual_quality_score !== undefined ? `${vision.visual_quality_score}/100` : '—'} />
              <KV k="Profile completeness" v={vision?.profile_completeness_score !== undefined ? `${vision.profile_completeness_score}/100` : '—'} />
            </Grid>
          </Section>
        )}

        {(vision?.brand_mentions?.length || vision?.has_paid_partnership !== undefined || vision?.has_collab_tag !== undefined) && (
          <Section title="Brand fit">
            <Grid>
              <KV k="Brand mentions" v={vision?.brand_mentions?.join(', ') || '—'} />
              <KV k="Paid partnerships" v={vision?.has_paid_partnership ? 'Yes' : 'No'} />
              <KV k="Collab tags" v={vision?.has_collab_tag ? 'Yes' : 'No'} />
              <KV k="Contact button" v={vision?.contact_button_visible ? 'Yes' : 'No'} />
              <KV k="External link" v={meta?.external_link ?? vision?.visible_external_link ?? '—'} />
              <KV k="Highlights visible" v={vision?.highlights?.length ? vision.highlights.join(', ') : '—'} />
            </Grid>
          </Section>
        )}

        {creator.credibility && (
          <Section title="Credibility breakdown">
            <div className="flex items-center gap-3 mb-3">
              <CredibilityChip score={creator.credibility.overall_score} badge={creator.credibility.badge} />
              <span className="text-sm text-ink-600">
                {creator.credibility.flags?.length ? creator.credibility.flags.join(' · ') : 'No flags raised'}
              </span>
            </div>
            {creator.credibility.signals && (
              <Grid>
                {Object.entries(creator.credibility.signals).map(([k, v]) => (
                  <KV
                    key={k}
                    k={k.replace(/_/g, ' ').replace(/^\w/, (s) => s.toUpperCase())}
                    v={v !== null && v !== undefined ? `${v}/100` : '—'}
                  />
                ))}
              </Grid>
            )}
          </Section>
        )}

        {vision?.safety_concerns && vision.safety_concerns.length > 0 && (
          <Section title="Safety">
            <div className="flex flex-wrap gap-1.5">
              {vision.safety_concerns.map((s) => (
                <span key={s} className="text-xs px-2 py-0.5 rounded-md bg-warn/10 text-warn border border-warn/30">
                  {s}
                </span>
              ))}
            </div>
          </Section>
        )}
      </div>

      <aside className="flex flex-col gap-2 lg:sticky lg:top-20 lg:self-start">
        <a
          href={`https://www.instagram.com/${c.handle}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2.5 rounded-[10px] bg-ink-900 hover:bg-ink-900/90 text-white text-sm font-medium text-center transition-colors flex items-center justify-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          Open profile <span className="text-xs">↗</span>
        </a>
        <button
          type="button"
          className="px-3 py-2.5 rounded-[10px] bg-canvas border border-border hover:border-ink-900/30 text-sm text-ink-900 text-left"
          onClick={(e) => e.stopPropagation()}
        >
          Generate outreach
        </button>
        <button
          type="button"
          className="px-3 py-2.5 rounded-[10px] bg-canvas border border-border hover:border-ink-900/30 text-sm text-ink-600 text-left"
          onClick={(e) => e.stopPropagation()}
        >
          Add to shortlist
        </button>
        <div className="mt-3 px-3 py-2 rounded-[10px] bg-surface text-[11px] text-ink-500 leading-relaxed">
          <div className="uppercase tracking-wider text-ink-400 mb-1">Source</div>
          {meta?.extracted_at ? `Scraped ${timeAgo(meta.extracted_at)}` : 'No metadata yet'}
          {meta?.vision_extracted_at && (
            <>
              <br />Vision-enriched {timeAgo(meta.vision_extracted_at)}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">{title}</div>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">{children}</div>;
}

function KV({ k, v }: { k: string; v: string | null | undefined }) {
  const value = v ?? '—';
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{k}</div>
      <div className="text-sm text-ink-900 truncate" title={value}>{value}</div>
    </div>
  );
}

function Avatar({ handle, src }: { handle: string; src: string | null }) {
  const initials = handle.slice(0, 2).toUpperCase();
  const [imgError, setImgError] = useState(!src);
  if (!src || imgError) {
    return (
      <div
        className="w-11 h-11 rounded-full text-white font-semibold text-sm flex items-center justify-center shrink-0 select-none"
        style={{ background: `linear-gradient(135deg, ${hashColor(handle, 0)}, ${hashColor(handle, 1)})` }}
      >
        {initials}
      </div>
    );
  }
  return (
    <div className="w-11 h-11 rounded-full bg-surface overflow-hidden shrink-0 border border-border-soft relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={handle}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="w-full h-full object-cover"
        onError={() => setImgError(true)}
      />
    </div>
  );
}

function VerifiedDot() {
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-blue-500 text-white shrink-0" title="Verified">
      <svg viewBox="0 0 16 16" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Stat({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <span className="text-ink-600 truncate">{value}</span>;
}

function CredibilityChip({ score, badge }: { score: number; badge: 'green' | 'amber' | 'red' }) {
  const colors = {
    green: 'bg-success/10 text-success border-success/30',
    amber: 'bg-warn/10 text-warn border-warn/30',
    red: 'bg-danger/10 text-danger border-danger/30',
  } as const;
  return (
    <div
      className={`px-2 py-0.5 rounded-md text-sm font-semibold border ${colors[badge]} shrink-0 tabular-nums`}
      title={`Credibility ${Math.round(score)}%`}
    >
      {Math.round(score)}
    </div>
  );
}

function FreshnessDot({ freshness }: { freshness: ShortlistCreatorView['freshness'] }) {
  const map = {
    just_scraped: { dot: 'bg-success', label: 'just researched' },
    fresh: { dot: 'bg-ink-300', label: 'fresh' },
    stale: { dot: 'bg-warn', label: 'refreshing' },
    refreshing: { dot: 'bg-warn animate-pulse', label: 'researching' },
  } as const;
  const f = map[freshness];
  return <span className={`w-1.5 h-1.5 rounded-full ${f.dot} shrink-0`} title={f.label} aria-label={f.label} />;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-ink-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function hasMetadata(creator: ShortlistCreatorView): boolean {
  return (
    creator.creator.primary_city !== null ||
    creator.creator.follower_count !== null ||
    creator.creator.engagement_rate !== null ||
    creator.raw_metadata?.tier !== null
  );
}

function previewReasoning(text: string | null): string | null {
  if (!text) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const start = lines[0]?.toLowerCase().startsWith('ranked') ? 1 : 0;
  const body = lines.slice(start).map((l) => l.replace(/^[·•\-*]\s*/, '').trim()).filter(Boolean);
  return body.length === 0 ? null : body.join(' · ');
}

const PALETTE = [
  ['#7c3aed', '#a855f7'],
  ['#0ea5e9', '#22d3ee'],
  ['#10b981', '#34d399'],
  ['#f59e0b', '#fbbf24'],
  ['#ef4444', '#f87171'],
  ['#ec4899', '#f472b6'],
  ['#6366f1', '#818cf8'],
  ['#14b8a6', '#2dd4bf'],
];
function hashColor(seed: string, idx: 0 | 1): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const pair = PALETTE[h % PALETTE.length]!;
  return pair[idx]!;
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return formatFollowers(n);
}

function tierLabel(tier: string | null | undefined): string | null {
  if (!tier) return null;
  const map: Record<string, string> = { mega: 'Mega', macro: 'Macro', micro: 'Micro', nano: 'Nano' };
  return map[tier] ?? tier;
}

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const min = Math.floor(d / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3_600_000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
