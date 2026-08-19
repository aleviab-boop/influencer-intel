// ============================================================
// Weekly brand pulse — the data behind the retention digest.
//
// For each brand a signed-in agency owns (brand_dna.account_id), gather the
// freshest trends in that brand's niche (from our own trend_signals) and a
// handful of new creators worth reaching (from the creator DB, scoped by the
// brand's DNA keywords). The cron (/api/cron/brand-pulse) groups these by
// account and emails one pulse per agency via sendBrandPulse.
//
// All best-effort: a missing table / empty niche just yields an empty section,
// and the cron skips accounts whose brands are all empty.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import type { BrandDnaProfile } from '@influencer-intel/shared/llm';
import { tokenize } from '@/lib/live-discovery';
import { searchCreatorsInDb } from '@/lib/creator-db-search';
import type { PulseBrandSection, PulseTrend, PulseCreator, PulsePipeline } from '@/lib/email';

/** One brand owned by an agency account — the unit a pulse section is built for. */
export interface PulseTarget {
  account_id: string;
  email: string;
  account_name: string;
  brand_name: string;
  dna: BrandDnaProfile;
}

/**
 * Every brand owned by an agency account that has an email — one row per
 * (account, brand), taking the latest DNA. These are the candidates the cron
 * builds pulse sections for and groups by account.
 */
export async function loadPulseTargets(): Promise<PulseTarget[]> {
  try {
    const rows = await getBolticClient().query<{
      account_id: string; email: string; account_name: string | null;
      brand_name: string; profile: BrandDnaProfile;
    }>(
      `SELECT DISTINCT ON (a.id, lower(bd.brand_name))
              a.id AS account_id, a.email, a.name AS account_name,
              bd.brand_name, bd.profile
         FROM brand_dna bd
         JOIN agency_accounts a ON a.id = bd.account_id
        WHERE a.email IS NOT NULL AND a.email <> ''
        ORDER BY a.id, lower(bd.brand_name), bd.created_at DESC`,
    );
    return rows.map((r) => ({
      account_id: r.account_id,
      email: r.email,
      account_name: r.account_name || r.email.split('@')[0]!,
      brand_name: r.brand_name,
      dna: r.profile,
    }));
  } catch {
    return [];
  }
}

// The liveliest trends in a category (emerging/growing/peak), for display.
async function loadNicheTrends(category: string, limit = 3): Promise<PulseTrend[]> {
  const tokens = category.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  try {
    const rows = await getBolticClient().query<{
      display_name: string; phase: string; velocity: string;
    }>(
      `SELECT display_name, phase, velocity::text AS velocity
         FROM trend_signals
        WHERE phase IN ('emerging','growing','peak')
          ${tokens.length ? 'AND (categories && $1::text[] OR categories IS NULL OR cardinality(categories) = 0)' : ''}
        ORDER BY CASE phase WHEN 'emerging' THEN 0 WHEN 'growing' THEN 1 ELSE 2 END,
                 velocity DESC
        LIMIT ${Math.max(1, Math.min(limit, 8))}`,
      tokens.length ? [tokens] : undefined,
    );
    return rows.map((r) => {
      const pct = Math.round(Number(r.velocity) * 100);
      return {
        display_name: r.display_name,
        phase: r.phase,
        growth_label: Number.isFinite(pct) ? `${pct >= 0 ? '+' : ''}${pct}% wk-on-wk` : '',
      };
    });
  } catch {
    return [];
  }
}

// A short creator shortlist for the brand's niche, seeded from its DNA.
async function loadNicheCreators(dna: BrandDnaProfile, limit = 4): Promise<PulseCreator[]> {
  const seed = [
    dna.category || '',
    ...(dna.keywords ?? []).slice(0, 4),
    ...(dna.creator_archetypes ?? []).slice(0, 2),
  ].join(' ');
  const tokens = tokenize(seed);
  if (tokens.length === 0) return [];
  try {
    const found = await searchCreatorsInDb(tokens, limit);
    return found.map((c) => ({
      handle: c.username,
      name: c.full_name || c.username,
      followers: Number(c.followers) || 0,
      engagement: c.engagement > 0 ? c.engagement : null,
    }));
  } catch {
    return [];
  }
}

// The agency's own funnel for this brand, as stage counts — a personal nudge
// ("3 awaiting reply") alongside the discovery content. Best-effort: a missing
// table / empty funnel yields null and the section falls back to discovery only.
async function loadPipelineStats(accountId: string, brandName: string): Promise<PulsePipeline | null> {
  try {
    const rows = await getBolticClient().query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n
         FROM brand_pipeline
        WHERE account_id = $1 AND lower(brand_name) = lower($2)
        GROUP BY status`,
      [accountId, brandName],
    );
    if (rows.length === 0) return null;
    const by = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
    const saved = by('saved'), contacted = by('contacted'), replied = by('replied');
    const negotiating = by('negotiating'), won = by('won');
    const pending = saved + contacted + replied + negotiating;
    return { saved, contacted, replied, negotiating, won, pending };
  } catch {
    return null;
  }
}

/** Build the pulse section for one brand (pipeline + trends + creators + a tip). */
export async function buildBrandSection(accountId: string, brandName: string, dna: BrandDnaProfile): Promise<PulseBrandSection> {
  const category = dna.category || '';
  const [trends, creators, pipeline] = await Promise.all([
    loadNicheTrends(category),
    loadNicheCreators(dna),
    loadPipelineStats(accountId, brandName),
  ]);
  return {
    brand_name: brandName,
    category,
    trends,
    creators,
    pipeline,
    top_opportunity: dna.opportunities?.[0] ?? null,
  };
}

/**
 * True when a section is worth emailing: fresh discovery content (a trend or a
 * creator) OR a pending pipeline the agency should act on. A funnel that's all
 * won/passed (nothing pending) doesn't, on its own, trigger a mail.
 */
export function sectionHasContent(s: PulseBrandSection): boolean {
  return s.trends.length > 0 || s.creators.length > 0 || (s.pipeline?.pending ?? 0) > 0;
}
