// ============================================================
// Earnings statement — the goal tracker answers "am I pacing this month" and the
// invoice bills a single deal, but at tax time a creator needs the whole picture:
// how much did I actually earn this financial year, from which brands, spread
// across which months, and roughly how much TDS was withheld. This rolls up the
// creator's PAID deals into an India-FY (April→March) statement they can read on
// screen or print for their accountant.
//
// Pure and deterministic: it only buckets and sums the program_recruits rows the
// route fetched — no ML/LLM, no writes. Both "today" and the target FY are
// injected so FY navigation and month bucketing are testable and timezone-honest.
// TDS is an ESTIMATE (a headline rate applied to gross); the actual figure comes
// from the payer's certificates, so it's labelled as such throughout.
// ============================================================

export interface StatementDealInput {
  id: string;
  program: string;
  brand: string;
  rate: number;
  paid: boolean;
  paid_at: string | null;   // ISO
  status: string;
}

export interface StatementMonth {
  key: string;        // YYYY-MM
  label: string;      // "Apr 2025"
  gross: number;
  deals: number;
}
export interface StatementBrand {
  brand: string;
  gross: number;
  deals: number;
  pct: number;        // share of FY gross, 0..100
}

export interface EarningsStatement {
  available: boolean;
  fy: string;             // "2025-26"
  fy_label: string;       // "FY 2025–26"
  fy_start: string;       // YYYY-MM-DD (1 Apr)
  fy_end: string;         // YYYY-MM-DD (31 Mar)
  prev_fy: string;
  next_fy: string;
  is_current_fy: boolean;
  currency: 'INR';
  gross: number;              // total realised income this FY
  deal_count: number;
  brand_count: number;
  avg_deal: number;
  tds_rate_pct: number;       // the estimate rate applied
  tds_estimate: number;
  net_estimate: number;       // gross − estimated TDS
  receivable: number;         // unpaid-but-live deals with a rate (not FY-scoped)
  months: StatementMonth[];   // Apr..Mar, always 12 rows
  brands: StatementBrand[];   // desc by gross
  headline: string;
  note: string;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIVE_STATUSES = new Set(['recruited', 'contacted', 'active', 'accepted', 'invited']);

// Default headline TDS estimate: 10% u/s 194J (professional/technical services),
// the most common band for creator collaborations.
const DEFAULT_TDS_PCT = 10;

const pad = (n: number): string => String(n).padStart(2, '0');
const money = (n: number): string => '\u20b9' + Math.round(n).toLocaleString('en-IN');

// India FY containing a given YYYY-MM-DD: Apr–Dec → that year, Jan–Mar → prior.
function fyOf(dateISO: string): string {
  const y = Number(dateISO.slice(0, 4));
  const m = Number(dateISO.slice(5, 7));
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${pad((startYear + 1) % 100)}`;
}

function shiftFY(fy: string, delta: number): string {
  const startYear = Number(fy.slice(0, 4)) + delta;
  return `${startYear}-${pad((startYear + 1) % 100)}`;
}

export function buildEarningsStatement(
  deals: StatementDealInput[],
  fyISO: string,      // "YYYY-YY" or "YYYY"; falls back to current FY
  todayISO: string,   // YYYY-MM-DD or ISO
): EarningsStatement {
  const today = todayISO.slice(0, 10);
  const currentFY = fyOf(today);
  const fy = /^\d{4}-\d{2}$/.test(fyISO) ? fyISO : /^\d{4}$/.test(fyISO) ? `${fyISO}-${pad((Number(fyISO) + 1) % 100)}` : currentFY;

  const startYear = Number(fy.slice(0, 4));
  const fyStart = `${startYear}-04-01`;
  const fyEnd = `${startYear + 1}-03-31`;
  const fyLabel = `FY ${startYear}\u2013${pad((startYear + 1) % 100)}`;

  // 12 month buckets, Apr(startYear)..Mar(startYear+1).
  const months: StatementMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const m0 = (3 + i) % 12;            // 3 = April
    const yr = m0 >= 3 ? startYear : startYear + 1;
    months.push({ key: `${yr}-${pad(m0 + 1)}`, label: `${MONTHS_SHORT[m0]} ${yr}`, gross: 0, deals: 0 });
  }
  const monthByKey = new Map(months.map((m) => [m.key, m]));

  const brandAgg = new Map<string, { gross: number; deals: number }>();
  let gross = 0;
  let dealCount = 0;
  let receivable = 0;

  for (const d of deals) {
    const rate = Math.max(0, Number(d.rate) || 0);
    const status = (d.status ?? '').toLowerCase();

    // Realised income: paid, with a payment date inside this FY.
    if (d.paid && d.paid_at) {
      const paidDay = d.paid_at.slice(0, 10);
      if (paidDay >= fyStart && paidDay <= fyEnd && rate > 0) {
        gross += rate;
        dealCount += 1;
        const mk = paidDay.slice(0, 7);
        const bucket = monthByKey.get(mk);
        if (bucket) { bucket.gross += rate; bucket.deals += 1; }
        const b = brandAgg.get(d.brand) ?? { gross: 0, deals: 0 };
        b.gross += rate; b.deals += 1;
        brandAgg.set(d.brand, b);
      }
    } else if (!d.paid && rate > 0 && (LIVE_STATUSES.has(status) || status === 'active')) {
      // Outstanding receivable — not FY-scoped, shown for context.
      receivable += rate;
    }
  }

  const brands: StatementBrand[] = [...brandAgg.entries()]
    .map(([brand, v]) => ({ brand, gross: v.gross, deals: v.deals, pct: gross > 0 ? Math.round((v.gross / gross) * 100) : 0 }))
    .sort((a, b) => b.gross - a.gross);

  const tdsRate = DEFAULT_TDS_PCT;
  const tdsEstimate = Math.round(gross * (tdsRate / 100));
  const netEstimate = gross - tdsEstimate;
  const avgDeal = dealCount > 0 ? Math.round(gross / dealCount) : 0;

  const headline = dealCount === 0
    ? `No paid earnings recorded for ${fyLabel} yet.`
    : `${money(gross)} earned across ${dealCount} paid deal${dealCount === 1 ? '' : 's'} in ${fyLabel}.`;

  const note = 'TDS shown is an estimate (10% u/s 194J). Your actual withholding is in the payer\u2019s Form 16A / 26AS — use those figures when filing.';

  return {
    available: dealCount > 0 || receivable > 0,
    fy,
    fy_label: fyLabel,
    fy_start: fyStart,
    fy_end: fyEnd,
    prev_fy: shiftFY(fy, -1),
    next_fy: shiftFY(fy, 1),
    is_current_fy: fy === currentFY,
    currency: 'INR',
    gross,
    deal_count: dealCount,
    brand_count: brands.length,
    avg_deal: avgDeal,
    tds_rate_pct: tdsRate,
    tds_estimate: tdsEstimate,
    net_estimate: netEstimate,
    receivable,
    months,
    brands,
    headline,
    note,
  };
}
