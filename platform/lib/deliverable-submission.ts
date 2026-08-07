// ============================================================
// Deliverable submission — a deal isn't really done when the content goes live;
// it's done when the creator has HANDED the brand the proof: the live post
// links. Every other view here manages a deal up to "in progress" and then jumps
// to "awaiting payment" — this closes the gap. It pairs the deal's parsed
// deliverables with the post URLs the creator has attached, tracks how many of
// the required pieces are covered, and produces the next action.
//
// Pure and deterministic: given the deal row plus the stored submissions array,
// the same view comes out every time — no ML/LLM, no writes. The route persists
// submissions into program_recruits.submissions; this module only computes and
// validates. "today" is injected for testable, timezone-honest relative dates.
// ============================================================

// A brand's verdict on one submitted link. Written by the brand-side review
// route; read here so the creator sees where each link stands.
export interface SubmissionReview {
  state: 'approved' | 'changes';
  at: string;              // ISO
  comment: string | null;
}

export interface SubmissionRecord {
  id: string;
  label: string | null;    // which deliverable this covers (free text)
  url: string;
  platform: SubmissionPlatform;
  note: string | null;
  created_at: string;       // ISO
  review?: SubmissionReview | null;   // brand verdict, if reviewed
}

export type SubmissionPlatform = 'instagram' | 'youtube' | 'tiktok' | 'x' | 'facebook' | 'link';

export interface SubmissionInput {
  id: string;
  program: string;
  brand: string;
  status: string;
  paid: boolean;
  due_date: string | null;      // YYYY-MM-DD
  deliverables: string | null;  // raw TEXT
  submissions: SubmissionRecord[];
}

export interface SubmissionEntry extends SubmissionRecord {
  domain: string;
  when_label: string;      // "2d ago", "today"
}
export interface DeliverableProgress { label: string; covered: boolean }

export interface SubmissionView {
  available: boolean;
  deal_id: string;
  program: string;
  brand: string;
  stage: 'invited' | 'in_progress' | 'complete' | 'paid';
  deliverables: DeliverableProgress[];
  submissions: SubmissionEntry[];
  required: number;        // count of parsed deliverables (min 1 if any content expected)
  submitted: number;       // count of attached links
  progress_pct: number;    // 0..100 toward required
  all_covered: boolean;
  can_submit: boolean;     // not an open invite, not paid
  due_label: string | null;
  headline: string;
  next_action: string;
}

const DAY_MS = 86_400_000;
const INVITE_STATUSES = new Set(['recruited', 'contacted', 'invited']);

function parseDeliverables(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n|;|\u00b7|\u2022|,(?=\s*\d)/)
    .map((s) => s.replace(/^[\s\-*\u2022\u00b7]+/, '').trim())
    .filter((s) => s.length > 0);
}

function daysBetween(fromISO: string, toISO: string): number | null {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

function relLabel(fromISO: string, today: string): string {
  const d = daysBetween(fromISO.slice(0, 10), today);
  if (d == null) return '';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(fromISO.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function dateLabel(iso: string): string {
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00Z' : ''));
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Detect the platform + a clean domain from a URL. Defensive: never throws.
export function detectPlatform(url: string): { platform: SubmissionPlatform; domain: string } {
  let host = '';
  try {
    host = new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    host = '';
  }
  if (/instagram\.com|instagr\.am/.test(host)) return { platform: 'instagram', domain: host || 'instagram.com' };
  if (/youtube\.com|youtu\.be/.test(host)) return { platform: 'youtube', domain: host || 'youtube.com' };
  if (/tiktok\.com/.test(host)) return { platform: 'tiktok', domain: host || 'tiktok.com' };
  if (/(^|\.)x\.com|twitter\.com/.test(host)) return { platform: 'x', domain: host || 'x.com' };
  if (/facebook\.com|fb\.watch/.test(host)) return { platform: 'facebook', domain: host || 'facebook.com' };
  return { platform: 'link', domain: host || 'link' };
}

// Validate + normalise one submission the client is trying to add. Requires an
// http(s) URL; label/note are trimmed and capped.
export function validateSubmission(
  input: { url?: unknown; label?: unknown; note?: unknown },
): { ok: boolean; error?: string; record?: Omit<SubmissionRecord, 'id' | 'created_at'> } {
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
  if (!rawUrl) return { ok: false, error: 'Paste the live post URL.' };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'That doesn\u2019t look like a valid link.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Link must start with http:// or https://' };
  }
  const { platform } = detectPlatform(rawUrl);
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 120) : '';
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 280) : '';
  return {
    ok: true,
    record: {
      label: label || null,
      url: rawUrl.slice(0, 2000),
      platform,
      note: note || null,
    },
  };
}

// Coerce whatever is stored in the JSONB column into a clean array.
export function normalizeStored(raw: unknown): SubmissionRecord[] {
  const arr = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!Array.isArray(arr)) return [];
  const out: SubmissionRecord[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.url !== 'string' || !r.url) continue;
    out.push({
      id: typeof r.id === 'string' ? r.id : `${out.length}`,
      label: typeof r.label === 'string' ? r.label : null,
      url: r.url,
      platform: typeof r.platform === 'string' ? (r.platform as SubmissionPlatform) : detectPlatform(r.url).platform,
      note: typeof r.note === 'string' ? r.note : null,
      created_at: typeof r.created_at === 'string' ? r.created_at : new Date(0).toISOString(),
      review: normalizeReview(r.review),
    });
  }
  return out;
}
function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// Preserve a stored brand review verbatim (so re-saving submissions never drops
// a verdict). Unknown shapes collapse to null.
function normalizeReview(raw: unknown): SubmissionReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.state !== 'approved' && r.state !== 'changes') return null;
  return {
    state: r.state,
    at: typeof r.at === 'string' ? r.at : new Date(0).toISOString(),
    comment: typeof r.comment === 'string' ? r.comment : null,
  };
}

// Apply (or clear, with null) a brand verdict on one submission by id, leaving
// every other field and record untouched. Returns a fresh array.
export function setSubmissionReview(
  records: SubmissionRecord[],
  submissionId: string,
  review: SubmissionReview | null,
): { records: SubmissionRecord[]; matched: boolean } {
  let matched = false;
  const next = records.map((r) => {
    if (r.id !== submissionId) return r;
    matched = true;
    return { ...r, review };
  });
  return { records: next, matched };
}

export function buildSubmissionView(d: SubmissionInput, todayISO: string): SubmissionView {
  const today = todayISO.slice(0, 10);
  const status = (d.status ?? '').toLowerCase();
  const deliverables = parseDeliverables(d.deliverables);
  const submissions = [...d.submissions].sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Required pieces: the parsed deliverables, or at least 1 if the deal is live
  // but the brand didn't spell them out.
  const required = Math.max(deliverables.length, submissions.length > 0 ? 1 : (INVITE_STATUSES.has(status) || d.paid ? 0 : 1));
  const submitted = submissions.length;

  // Pair each deliverable with a submission whose label matches (loose,
  // case-insensitive substring), else fill in submission order.
  const used = new Set<string>();
  const progress: DeliverableProgress[] = deliverables.map((label) => {
    const lc = label.toLowerCase();
    const match = submissions.find((s) => !used.has(s.id) && s.label && (s.label.toLowerCase().includes(lc) || lc.includes(s.label.toLowerCase())));
    if (match) { used.add(match.id); return { label, covered: true }; }
    return { label, covered: false };
  });
  // Any unmatched submissions cover remaining uncovered deliverables in order.
  let spare = submissions.filter((s) => !used.has(s.id)).length;
  for (const p of progress) {
    if (!p.covered && spare > 0) { p.covered = true; spare -= 1; }
  }

  const coveredCount = progress.filter((p) => p.covered).length;
  const effectiveCovered = deliverables.length > 0 ? coveredCount : Math.min(submitted, required);
  const progressPct = required > 0 ? Math.min(100, Math.round((effectiveCovered / required) * 100)) : (submitted > 0 ? 100 : 0);
  const allCovered = required > 0 ? effectiveCovered >= required : submitted > 0;

  let stage: SubmissionView['stage'];
  if (d.paid) stage = 'paid';
  else if (INVITE_STATUSES.has(status)) stage = 'invited';
  else if (allCovered && submitted > 0) stage = 'complete';
  else stage = 'in_progress';

  const canSubmit = stage !== 'invited' && stage !== 'paid';

  const withMeta: SubmissionEntry[] = submissions.map((s) => {
    const { domain } = detectPlatform(s.url);
    return { ...s, domain, when_label: relLabel(s.created_at, today), review: s.review ?? null };
  });

  const dueLabel = d.due_date ? dateLabel(d.due_date) : null;

  let headline: string;
  let nextAction: string;
  if (stage === 'invited') {
    headline = 'Respond to the invite before submitting work.';
    nextAction = 'Accept the deal on the brief screen, then come back to attach your posts.';
  } else if (stage === 'paid') {
    headline = submitted > 0 ? `${submitted} link${submitted === 1 ? '' : 's'} on file — this deal is paid and closed.` : 'This deal is paid and closed.';
    nextAction = 'Nothing left to do here.';
  } else if (allCovered) {
    headline = `All ${required} deliverable${required === 1 ? '' : 's'} submitted. Nice.`;
    nextAction = 'Message the brand to confirm delivery and raise your invoice.';
  } else if (submitted > 0) {
    headline = `${effectiveCovered} of ${required} deliverable${required === 1 ? '' : 's'} submitted.`;
    nextAction = 'Attach the remaining live post link(s) as they go up.';
  } else {
    headline = required > 0 ? `${required} deliverable${required === 1 ? '' : 's'} to submit.` : 'Attach your live post links here once you publish.';
    nextAction = dueLabel ? `Publish and attach your links${d.due_date && (daysBetween(today, d.due_date) ?? 0) < 0 ? ' — this is past due' : ` by ${dueLabel}`}.` : 'Publish, then paste the live post URL to log it.';
  }

  return {
    available: true,
    deal_id: d.id,
    program: d.program,
    brand: d.brand,
    stage,
    deliverables: progress,
    submissions: withMeta,
    required,
    submitted,
    progress_pct: progressPct,
    all_covered: allCovered,
    can_submit: canSubmit,
    due_label: dueLabel,
    headline,
    next_action: nextAction,
  };
}
