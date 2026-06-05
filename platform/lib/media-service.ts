// ============================================================
// Media Management — creative asset library + approval workflow.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import type { CreativeAsset, AssetStatus, AssetType } from '@influencer-intel/shared/types';

export interface AssetRow extends CreativeAsset {
  program_name: string | null;
}

export async function listAssets(): Promise<AssetRow[]> {
  const db = getBolticClient();
  return db.query<AssetRow>(
    `SELECT ca.*, p.name AS program_name
     FROM creative_assets ca
     LEFT JOIN programs p ON p.id = ca.program_id
     ORDER BY ca.created_at DESC`,
  );
}

export async function createAsset(input: {
  title: string;
  asset_type?: AssetType;
  asset_url?: string | null;
  caption?: string | null;
  program_id?: string | null;
  creator_handle?: string | null;
}): Promise<CreativeAsset> {
  const db = getBolticClient();
  return db.insert<CreativeAsset>('creative_assets', {
    title: input.title,
    asset_type: input.asset_type ?? 'reel',
    asset_url: input.asset_url ?? null,
    caption: input.caption ?? null,
    program_id: input.program_id ?? null,
    creator_handle: input.creator_handle ?? null,
    status: 'draft',
    version: 1,
    note: null,
  });
}

export async function updateAsset(
  id: string,
  patch: Partial<Pick<CreativeAsset, 'title' | 'asset_type' | 'asset_url' | 'caption' | 'status' | 'note'>>,
): Promise<CreativeAsset | null> {
  const db = getBolticClient();
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;
  // Bump version when a creative is re-submitted after changes.
  if (patch.status === 'in_review') {
    const rows = await db.query<CreativeAsset>(
      `UPDATE creative_assets SET status = 'in_review',
         version = CASE WHEN status = 'changes' THEN version + 1 ELSE version END,
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id],
    );
    return rows[0] ?? null;
  }
  const rows = await db.update<CreativeAsset>('creative_assets', { id }, set);
  return rows[0] ?? null;
}

export async function deleteAsset(id: string): Promise<void> {
  const db = getBolticClient();
  await db.query(`DELETE FROM creative_assets WHERE id = $1`, [id]);
}

export const ASSET_STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'changes'];
