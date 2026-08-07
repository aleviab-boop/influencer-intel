// ============================================================
// Creator payout details — a creator can now run deals and see what they're
// owed, but there's nowhere to say HOW they should be paid. This is the payment
// settings surface: a UPI ID or a bank account, validated to Indian formats so
// finance doesn't bounce a transfer on a typo'd IFSC.
//
// This is the PURE half — it validates and normalises a payout payload and
// returns a storage object plus a masked "display" view (we never echo a full
// account number back to the client). It never touches the DB; the route
// persists the storage object into the creators.payout_details JSONB column.
// No ML/LLM — just format rules.
// ============================================================

export type PayoutMethod = 'upi' | 'bank';

export interface PayoutInput {
  method?: unknown;
  upi_id?: unknown;
  account_holder?: unknown;
  account_number?: unknown;
  ifsc?: unknown;
}

// What we persist (JSONB). Account numbers are stored as entered so a real
// transfer can be made; the API only ever RETURNS the masked view below.
export interface PayoutRecord {
  method: PayoutMethod;
  upi_id: string | null;
  account_holder: string | null;
  account_number: string | null;
  ifsc: string | null;
  updated_at: string;
}

// Safe-to-return view — no full account number.
export interface PayoutDisplay {
  method: PayoutMethod;
  upi_id: string | null;
  account_holder: string | null;
  account_last4: string | null;
  ifsc: string | null;
  updated_at: string | null;
  complete: boolean;
}

export interface PayoutValidation {
  ok: boolean;
  record: PayoutRecord | null;
  errors: Partial<Record<'method' | 'upi_id' | 'account_holder' | 'account_number' | 'ifsc', string>>;
}

const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCT_RE = /^\d{6,18}$/;

const str = (v: unknown): string => (v == null ? '' : String(v).trim());

export function maskAccount(acct: string | null): string | null {
  if (!acct) return null;
  const digits = acct.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** Reduce a stored record to the safe display view returned by the API. */
export function toDisplay(rec: PayoutRecord | null): PayoutDisplay | null {
  if (!rec) return null;
  const complete = rec.method === 'upi'
    ? !!rec.upi_id
    : !!(rec.account_holder && rec.account_number && rec.ifsc);
  return {
    method: rec.method,
    upi_id: rec.upi_id,
    account_holder: rec.account_holder,
    account_last4: maskAccount(rec.account_number),
    ifsc: rec.ifsc,
    updated_at: rec.updated_at ?? null,
    complete,
  };
}

/**
 * Validate + normalise a payout payload. UPI method needs a valid UPI ID; bank
 * method needs holder + account number + IFSC. `todayISO` stamps the record.
 */
export function validatePayout(input: PayoutInput, todayISO: string): PayoutValidation {
  const errors: PayoutValidation['errors'] = {};
  const method = str(input.method).toLowerCase();

  if (method !== 'upi' && method !== 'bank') {
    return { ok: false, record: null, errors: { method: 'Choose UPI or bank transfer.' } };
  }

  if (method === 'upi') {
    const upi = str(input.upi_id);
    if (!upi) errors.upi_id = 'Enter your UPI ID.';
    else if (!UPI_RE.test(upi)) errors.upi_id = 'That doesn\u2019t look like a valid UPI ID (e.g. name@okaxis).';

    if (Object.keys(errors).length) return { ok: false, record: null, errors };
    return {
      ok: true,
      errors,
      record: {
        method: 'upi', upi_id: upi, account_holder: null, account_number: null, ifsc: null,
        updated_at: todayISO,
      },
    };
  }

  // Bank transfer.
  const holder = str(input.account_holder);
  const acct = str(input.account_number).replace(/\s/g, '');
  const ifsc = str(input.ifsc).toUpperCase().replace(/\s/g, '');

  if (!holder) errors.account_holder = 'Enter the account holder\u2019s name.';
  else if (holder.length > 120) errors.account_holder = 'Name is too long.';
  if (!acct) errors.account_number = 'Enter your account number.';
  else if (!ACCT_RE.test(acct)) errors.account_number = 'Account number should be 6\u201318 digits.';
  if (!ifsc) errors.ifsc = 'Enter the IFSC code.';
  else if (!IFSC_RE.test(ifsc)) errors.ifsc = 'That IFSC code isn\u2019t valid (e.g. HDFC0001234).';

  if (Object.keys(errors).length) return { ok: false, record: null, errors };
  return {
    ok: true,
    errors,
    record: {
      method: 'bank', upi_id: null, account_holder: holder, account_number: acct, ifsc,
      updated_at: todayISO,
    },
  };
}
