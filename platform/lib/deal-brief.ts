// ============================================================
// Deal brief — the deals list gives a creator the at-a-glance lifecycle, but
// when a brand invite lands they need the full picture on one screen: what's
// being asked, what it pays, by when, and — the part creators actually struggle
// with — WHAT TO SAY BACK. This expands a single program_recruits row into a
// structured brief and three ready-to-send message drafts (accept, counter,
// clarify) they can copy, tweak and paste.
//
// Pure and deterministic: it only reshapes and templates the one row the route
// fetched. The message drafts are fixed templates with the deal's own values
// slotted in — no ML, no LLM, nothing invented. "today" is injected for
// testable, timezone-honest date math.
// ============================================================

export interface DealBriefInput {
  id: string;
  brand: string;
  program: string;
  description: string | null;
  rate: number;
  paid: boolean;
  paid_at: string | null;
  status: string;
  deliverables: string | null;
  due_date: string | null;   // YYYY-MM-DD
  note: string | null;
  created_at: string | null;  // ISO
}

export interface DealBrief {
  available: boolean;
  id: string;
  brand: string;
  program: string;
  description: string | null;
  note: string | null;
  deliverables: string[];
  rate: number;
  rate_label: string;
  stage: 'invited' | 'in_progress' | 'awaiting_payment' | 'paid';
  stage_label: string;
  can_respond: boolean;        // an open invite the creator hasn't committed to
  due_date: string | null;
  due_label: string | null;
  days_to_due: number | null;
  timeline: { label: string; value: string }[];
  drafts: { key: 'accept' | 'counter' | 'clarify'; label: string; body: string }[];
}

const DAY_MS = 86_400_000;
const INVITE_STATUSES = new Set(['recruited', 'contacted', 'invited']);

const money = (n: number): string => (n > 0 ? '\u20b9' + n.toLocaleString('en-IN') : '');

function daysBetween(fromISO: string, toISO: string): number | null {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

function dateLabel(iso: string): string {
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00Z' : ''));
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function parseDeliverables(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n|;|\u00b7|\u2022|,(?=\s*\d)/)
    .map((s) => s.replace(/^[\s\-*\u2022\u00b7]+/, '').trim())
    .filter((s) => s.length > 0);
}

function roundNice(v: number): number {
  if (v <= 0) return 0;
  if (v < 2_000) return Math.round(v / 100) * 100;
  if (v < 20_000) return Math.round(v / 500) * 500;
  return Math.round(v / 1_000) * 1_000;
}

export function buildDealBrief(d: DealBriefInput, todayISO: string): DealBrief {
  const today = todayISO.slice(0, 10);
  const rate = Number(d.rate) || 0;
  const status = (d.status ?? '').toLowerCase();
  const deliverables = parseDeliverables(d.deliverables);
  const daysToDue = d.due_date ? daysBetween(today, d.due_date) : null;

  let stage: DealBrief['stage'];
  if (d.paid) stage = 'paid';
  else if (INVITE_STATUSES.has(status)) stage = 'invited';
  else if (d.due_date && daysToDue != null && daysToDue < 0) stage = 'awaiting_payment';
  else stage = 'in_progress';

  const stageLabel = stage === 'paid' ? 'Paid'
    : stage === 'awaiting_payment' ? 'Awaiting payment'
    : stage === 'invited' ? 'Invitation'
    : 'In progress';

  const canRespond = stage === 'invited';

  // Timeline facts.
  const timeline: { label: string; value: string }[] = [];
  if (d.created_at) timeline.push({ label: 'Received', value: dateLabel(d.created_at.slice(0, 10)) });
  if (d.due_date) timeline.push({ label: 'Delivery due', value: dateLabel(d.due_date) });
  if (d.paid && d.paid_at) timeline.push({ label: 'Paid', value: dateLabel(d.paid_at.slice(0, 10)) });

  // ---- Response drafts (templates; the deal's own values slotted in) --------
  const rateStr = money(rate);
  const deliverLine = deliverables.length
    ? deliverables.map((x) => `\u2022 ${x}`).join('\n')
    : 'the agreed deliverables';
  const byWhen = d.due_date ? ` by ${dateLabel(d.due_date)}` : ' on a timeline that works for you';
  const counterLow = roundNice(rate * 1.15);
  const counterHigh = roundNice(rate * 1.35);

  const accept =
    `Hi ${d.brand} team,\n\n` +
    `Thanks for thinking of me for ${d.program} \u2014 I\u2019d love to come on board. ` +
    `I can deliver${byWhen}:\n${deliverLine}\n\n` +
    (rateStr ? `The ${rateStr} rate works for this scope. ` : '') +
    `Send over the brief, brand assets and any do\u2019s/don\u2019ts and I\u2019ll get started. Excited to work together!`;

  const counter =
    `Hi ${d.brand} team,\n\n` +
    `Really keen on ${d.program} and the fit feels right. ` +
    (rate > 0
      ? `For this scope (${deliverables.length ? deliverables.length + ' deliverable' + (deliverables.length === 1 ? '' : 's') : 'the deliverables listed'}` +
        `, usage rights and turnaround), my rate usually lands at ${money(counterLow)}\u2013${money(counterHigh)}. `
      : `Before I confirm, could you share the budget for this scope so I can align on rate? `) +
    `Happy to find a number that works \u2014 let me know your thoughts and I\u2019ll lock in the timeline.`;

  const clarify =
    `Hi ${d.brand} team,\n\n` +
    `Thanks for the invite to ${d.program}! Before I confirm, a few quick questions so I quote and plan accurately:\n\n` +
    `\u2022 Deliverables & format \u2014 ${deliverables.length ? 'confirming: ' + deliverables.join(', ') : 'how many posts/reels/stories?'}\n` +
    `\u2022 Usage rights \u2014 organic only, or paid/whitelisting, and for how long?\n` +
    `\u2022 Timeline \u2014 ${d.due_date ? `is ${dateLabel(d.due_date)} the hard deadline?` : 'what\u2019s the go-live date?'}\n` +
    `\u2022 Approvals \u2014 how many review rounds should I plan for?\n\n` +
    `Once I have these I can confirm rate and get moving.`;

  return {
    available: true,
    id: d.id,
    brand: d.brand,
    program: d.program,
    description: d.description,
    note: d.note,
    deliverables,
    rate,
    rate_label: rateStr || 'Rate to be confirmed',
    stage,
    stage_label: stageLabel,
    can_respond: canRespond,
    due_date: d.due_date,
    due_label: d.due_date ? dateLabel(d.due_date) : null,
    days_to_due: daysToDue,
    timeline,
    drafts: [
      { key: 'accept', label: 'Accept', body: accept },
      { key: 'counter', label: 'Counter-offer', body: counter },
      { key: 'clarify', label: 'Ask questions', body: clarify },
    ],
  };
}
