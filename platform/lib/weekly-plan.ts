// ============================================================
// This week's focus — the dashboard's "do these 3 things" digest.
//
// Every other card answers one question in depth; a creator opening the portal
// on a Monday wants the opposite: a short, prioritised shortlist of what
// actually moves the needle this week. This collapses the strongest signals —
// the next post to make, the window to post it in, the one thing to fix, and
// the warmest brand to pitch — into at most three concrete actions.
//
// Pure synthesis of signals computed elsewhere; no new data, no LLM. We build a
// candidate pool, then greedily pick the highest-priority actions while keeping
// the mix diverse (one CREATE, one FIX/GROW, one PITCH where possible).
// ============================================================

// The plan only reads a handful of fields off each analysis, so we depend on
// minimal structural shapes rather than the full analysis types. This keeps the
// lib decoupled from — and resilient to — those modules' exact interfaces.
export interface RecLike { id: string; kind: string; title: string; body: string; priority: number }
export interface BriefLike { format: string; window: string | null; hook: string; why: string }
export interface PlaybookLike { available: boolean; briefs: BriefLike[] }
export interface BestBetLike { format_label: string; part_label: string; range: string; avg_er: number }
export interface FormatTimingLike { best_bet: BestBetLike | null }
export interface PostingTimeLike {
  best_day: { label: string } | null;
  best_part: { label: string; range: string } | null;
}
export interface TrendLike { available: boolean; trend: 'rising' | 'steady' | 'cooling' | null; momentum_pct: number | null }

export type ActionTag = 'CREATE' | 'TIME' | 'FIX' | 'PITCH' | 'GROW';

export interface WeeklyAction {
  n: number;
  tag: ActionTag;
  title: string;
  detail: string;
  why: string | null;   // the evidence line
}

export interface WeeklyPlan {
  available: boolean;
  headline: string;
  actions: WeeklyAction[];
}

export interface BrandLead {
  brand_name: string;
  program_name: string;
  reason: string;
}

export interface WeeklyPlanInput {
  recommendations: RecLike[];
  content_playbook: PlaybookLike | null;
  format_timing: FormatTimingLike | null;
  posting_time: PostingTimeLike | null;
  engagement_trend: TrendLike | null;
  brand_lead: BrandLead | null;
}

interface Candidate { priority: number; tag: ActionTag; title: string; detail: string; why: string | null }

const TAG_LABEL: Record<ActionTag, string> = {
  CREATE: 'Create', TIME: 'Timing', FIX: 'Fix', PITCH: 'Pitch', GROW: 'Grow',
};
export { TAG_LABEL };

// Best posting window as a short phrase, preferring the format-specific bet.
function windowPhrase(ft: FormatTimingLike | null, pt: PostingTimeLike | null): string | null {
  if (ft?.best_bet) return `${ft.best_bet.part_label.toLowerCase()} (${ft.best_bet.range} IST)`;
  if (pt?.best_part) {
    const day = pt.best_day ? `${pt.best_day.label} ` : '';
    return `${day}${pt.best_part.label.toLowerCase()} (${pt.best_part.range} IST)`;
  }
  return null;
}

export function buildWeeklyPlan(input: WeeklyPlanInput): WeeklyPlan {
  const { recommendations: recs, content_playbook: cp, format_timing: ft, posting_time: pt, engagement_trend: et, brand_lead: lead } = input;
  const win = windowPhrase(ft, pt);
  const candidates: Candidate[] = [];

  // ---- CREATE: the next post to make (from the playbook) -----------------
  const brief = cp?.available ? cp.briefs[0] : null;
  if (brief) {
    candidates.push({
      priority: 10,
      tag: 'CREATE',
      title: `Shoot a ${brief.format}${win ? ` for ${win}` : brief.window ? ` for ${brief.window}` : ''}`,
      detail: brief.hook,
      why: brief.why,
    });
  }

  // ---- TIME: post in the peak window -------------------------------------
  if (ft?.best_bet) {
    candidates.push({
      priority: 6,
      tag: 'TIME',
      title: `Post your ${ft.best_bet.format_label.replace(/s$/, '')} in the ${ft.best_bet.part_label.toLowerCase()}`,
      detail: `${ft.best_bet.format_label} in the ${ft.best_bet.range} IST window average ${(ft.best_bet.avg_er * 100).toFixed(1)}% engagement for you — your strongest combo.`,
      why: 'From your format × timing grid.',
    });
  } else if (pt?.best_part) {
    const day = pt.best_day ? `${pt.best_day.label} ` : '';
    candidates.push({
      priority: 5,
      tag: 'TIME',
      title: 'Post in your peak window',
      detail: `Your engagement is highest ${day}in the ${pt.best_part.label.toLowerCase()} (${pt.best_part.range} IST). Schedule your key post then.`,
      why: 'From your best-time analysis.',
    });
  }

  // ---- FIX / GROW: the top recommendation --------------------------------
  const topRec = recs[0] ?? null;
  if (topRec) {
    const tag: ActionTag = topRec.kind === 'growth' ? 'GROW' : topRec.kind === 'money' ? 'PITCH' : 'FIX';
    candidates.push({
      priority: Math.max(6, topRec.priority),   // keep it in contention
      tag,
      title: topRec.title,
      detail: topRec.body,
      why: 'Your top recommended focus.',
    });
  }

  // ---- GROW: engagement momentum -----------------------------------------
  if (et?.available && et.trend === 'cooling' && et.momentum_pct != null) {
    candidates.push({
      priority: 7,
      tag: 'GROW',
      title: 'Reset your engagement momentum',
      detail: `Overall engagement has dipped ${Math.abs(et.momentum_pct)}% recently. Try a fresh angle and a harder hook to re-engage your audience.`,
      why: 'From your engagement trend.',
    });
  } else if (et?.available && et.trend === 'rising' && et.momentum_pct != null) {
    candidates.push({
      priority: 4,
      tag: 'GROW',
      title: 'Ride your momentum',
      detail: `Engagement is up ${et.momentum_pct}% across recent posts. Keep this cadence and double down on what's working while the algorithm favours you.`,
      why: 'From your engagement trend.',
    });
  }

  // ---- PITCH: the warmest brand lead -------------------------------------
  if (lead) {
    candidates.push({
      priority: 8,
      tag: 'PITCH',
      title: `Pitch ${lead.brand_name}`,
      detail: `${lead.reason} Send them your media kit and a short, numbers-led note this week.`,
      why: `Active campaign: ${lead.program_name}.`,
    });
  }

  // ---- Greedy diverse pick: highest priority, one action per tag ---------
  candidates.sort((a, b) => b.priority - a.priority);
  const picked: Candidate[] = [];
  const usedTags = new Set<ActionTag>();
  for (const c of candidates) {
    if (usedTags.has(c.tag)) continue;
    picked.push(c);
    usedTags.add(c.tag);
    if (picked.length === 3) break;
  }
  // If diversity left us short (few signals), backfill with any remaining.
  if (picked.length < 3) {
    for (const c of candidates) {
      if (picked.includes(c)) continue;
      picked.push(c);
      if (picked.length === 3) break;
    }
  }

  const actions: WeeklyAction[] = picked.map((c, i) => ({
    n: i + 1, tag: c.tag, title: c.title, detail: c.detail, why: c.why,
  }));

  const headline = actions.length
    ? `Your ${actions.length} focus${actions.length === 1 ? '' : 'es'} for the week — ordered by impact.`
    : '';

  return { available: actions.length > 0, headline, actions };
}
