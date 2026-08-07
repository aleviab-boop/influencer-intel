// ============================================================
// Invoice builder — a creator can run a deal and set how they get paid, but to
// actually GET paid they have to send the brand an invoice, and most cobble one
// together in Google Docs. This turns a single deal (program_recruits row) plus
// the creator's own profile and payout details into a clean, brand-billable
// invoice: a deterministic invoice number, the deliverables as a line item, an
// India-aware GST/TDS breakdown, and the pay-to instructions.
//
// Pure and deterministic: it only reshapes the rows the route fetched and does
// arithmetic — no ML/LLM, no writes. "today" is injected so the invoice number
// and issue date are testable and timezone-honest. Amounts are plain numbers in
// INR; the page formats them.
// ============================================================

export interface InvoiceDealInput {
  id: string;
  program: string;
  brand: string;
  rate: number;
  deliverables: string | null;
  due_date: string | null;   // YYYY-MM-DD
  paid: boolean;
  paid_at: string | null;
}
export interface InvoiceCreatorInput {
  handle: string;
  display_name: string | null;
  primary_city: string | null;
  email: string | null;
}
export interface InvoicePayoutInput {
  method: 'upi' | 'bank' | null;
  upi_id: string | null;
  account_holder: string | null;
  account_number: string | null;   // full — an invoice legitimately shows it
  ifsc: string | null;
}

export interface InvoiceLine { description: string; qty: number; rate: number; amount: number }
export interface Invoice {
  available: boolean;
  number: string;
  issue_date: string;      // YYYY-MM-DD
  due_note: string;        // human payment-terms line
  status: 'paid' | 'unpaid';
  from: { name: string; handle: string; location: string | null; email: string | null };
  to: { name: string };
  lines: InvoiceLine[];
  currency: 'INR';
  subtotal: number;
  gst_pct: number;
  gst_amount: number;
  total: number;
  tds_note: string;
  pay_to: { method: 'upi' | 'bank'; lines: { label: string; value: string }[] } | null;
  notes: string[];
}

function parseDeliverables(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n|;|\u00b7|\u2022|,(?=\s*\d)/)
    .map((s) => s.replace(/^[\s\-*\u2022\u00b7]+/, '').trim())
    .filter((s) => s.length > 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build an invoice for a single deal. `gstPct` defaults to 0 (most small
 * creators aren't GST-registered); pass 18 to add GST. TDS is shown as an
 * informational note only, because the payer deducts it — it doesn't change the
 * invoice total the creator raises.
 */
export function buildInvoice(
  deal: InvoiceDealInput,
  creator: InvoiceCreatorInput,
  payout: InvoicePayoutInput,
  todayISO: string,
  gstPct = 0,
): Invoice {
  const today = todayISO.slice(0, 10);
  const shortId = (deal.id || '').replace(/-/g, '').slice(0, 6).toUpperCase() || 'DEAL';
  const number = `INV-${today.replace(/-/g, '')}-${shortId}`;

  const deliverables = parseDeliverables(deal.deliverables);
  const rate = Math.max(0, Number(deal.rate) || 0);

  // Single line: the campaign, with its deliverables spelled out underneath.
  const description = deliverables.length
    ? `${deal.program} — ${deliverables.join(', ')}`
    : `${deal.program} — content collaboration`;
  const lines: InvoiceLine[] = [{ description, qty: 1, rate, amount: rate }];

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const gst = gstPct > 0 ? round2(subtotal * (gstPct / 100)) : 0;
  const total = round2(subtotal + gst);

  const status: Invoice['status'] = deal.paid ? 'paid' : 'unpaid';
  const dueNote = deal.paid
    ? `Paid${deal.paid_at ? ` on ${deal.paid_at.slice(0, 10)}` : ''}.`
    : 'Payment due within 15 days of receipt.';

  // Pay-to block, from the creator's saved payout method.
  let payTo: Invoice['pay_to'] = null;
  if (payout.method === 'upi' && payout.upi_id) {
    payTo = { method: 'upi', lines: [{ label: 'UPI ID', value: payout.upi_id }] };
  } else if (payout.method === 'bank' && payout.account_number && payout.ifsc) {
    payTo = {
      method: 'bank',
      lines: [
        { label: 'Account holder', value: payout.account_holder ?? (creator.display_name ?? creator.handle) },
        { label: 'Account number', value: payout.account_number },
        { label: 'IFSC', value: payout.ifsc },
      ],
    };
  }

  const notes: string[] = [];
  if (gstPct === 0) notes.push('GST not applicable / not registered.');
  if (!payTo) notes.push('Add your payout details in Settings so brands know where to pay.');

  return {
    available: true,
    number,
    issue_date: today,
    due_note: dueNote,
    status,
    from: {
      name: creator.display_name ?? creator.handle,
      handle: creator.handle,
      location: creator.primary_city,
      email: creator.email,
    },
    to: { name: deal.brand },
    lines,
    currency: 'INR',
    subtotal,
    gst_pct: gstPct,
    gst_amount: gst,
    total,
    tds_note: 'TDS, if any, will be deducted by the payer as applicable (e.g. 10% u/s 194J for professional/technical services).',
    pay_to: payTo,
    notes,
  };
}
