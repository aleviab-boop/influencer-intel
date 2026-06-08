// ============================================================
// Payout methods — the ways a brand pays creators (UPI / bank / PayPal /
// other). Brand-scoped is optional here (single-tenant demo), so we list all.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';

export type PayoutMethodType = 'upi' | 'bank' | 'paypal' | 'other';

export interface PayoutMethod {
  id: string;
  label: string;
  type: PayoutMethodType;
  detail: string | null;
  is_default: boolean;
  created_at: string;
}

export async function listPayoutMethods(): Promise<PayoutMethod[]> {
  const db = getBolticClient();
  return db.query<PayoutMethod>(
    `SELECT id, label, type, detail, is_default, created_at::text AS created_at
     FROM payout_methods
     ORDER BY is_default DESC, created_at ASC`,
  );
}

export async function createPayoutMethod(input: { label: string; type: PayoutMethodType; detail?: string | null }): Promise<PayoutMethod> {
  const db = getBolticClient();
  // First method added becomes the default.
  const existing = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM payout_methods`);
  const isFirst = (existing[0]?.n ?? 0) === 0;
  const rows = await db.query<PayoutMethod>(
    `INSERT INTO payout_methods (label, type, detail, is_default)
     VALUES ($1, $2, $3, $4)
     RETURNING id, label, type, detail, is_default, created_at::text AS created_at`,
    [input.label, input.type, input.detail ?? null, isFirst],
  );
  return rows[0]!;
}

export async function deletePayoutMethod(id: string): Promise<boolean> {
  const db = getBolticClient();
  const rows = await db.query<{ id: string; is_default: boolean }>(
    `DELETE FROM payout_methods WHERE id = $1 RETURNING id, is_default`,
    [id],
  );
  if (rows.length === 0) return false;
  // If we removed the default, promote the oldest remaining one.
  if (rows[0]!.is_default) {
    await db.query(
      `UPDATE payout_methods SET is_default = TRUE
       WHERE id = (SELECT id FROM payout_methods ORDER BY created_at ASC LIMIT 1)`,
    );
  }
  return true;
}

export async function setDefaultPayoutMethod(id: string): Promise<boolean> {
  const db = getBolticClient();
  const found = await db.query<{ id: string }>(`SELECT id FROM payout_methods WHERE id = $1`, [id]);
  if (found.length === 0) return false;
  await db.query(`UPDATE payout_methods SET is_default = (id = $1)`, [id]);
  return true;
}
