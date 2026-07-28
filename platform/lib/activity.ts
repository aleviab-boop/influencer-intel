import { getBolticClient } from '@influencer-intel/shared/db';

// Lightweight product-activity log — powers the admin Metrics "logins / DAU"
// panel. Best-effort and fire-and-forget: an analytics write must never break a
// login or a search. Callers should NOT await this (or should .catch()).

export type ActivityKind = 'login' | 'signup' | 'search';

export async function logActivity(input: {
  kind: ActivityKind;
  brand_id?: string | null;
  email?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await getBolticClient().query(
      `INSERT INTO activity_events (brand_id, email, kind, meta) VALUES ($1, $2, $3, $4)`,
      [input.brand_id ?? null, input.email ?? null, input.kind, input.meta ? JSON.stringify(input.meta) : null],
    );
  } catch {
    /* analytics is non-critical — swallow */
  }
}
