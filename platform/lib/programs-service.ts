// ============================================================
// Programs service — Discover & Recruit.
//
// A program is a named recruitment campaign. Influencers discovered via
// /api/discover are recruited into it and move through a status pipeline
// (invited → contacted → recruited → declined).
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import type { Program, ProgramRecruit, ProgramStatus, RecruitStatus } from '@influencer-intel/shared/types';
import { getSession } from './auth';

export interface ProgramSummary extends Program {
  recruit_count: number;
  recruited_count: number;
  spent: number;
}

export interface ProgramRecruitView extends ProgramRecruit {
  handle: string;
  display_name: string | null;
  profile_url: string;
  profile_photo_url: string | null;
  follower_count: number | null;
  platform: string;
  genre: string | null;
  region: string | null;
  niche: string | null;
  quality_score: number | null;
}

// List campaigns. When `brandId` is given (a signed-in brand), we scope to that
// brand's own programs PLUS any legacy/unassigned ones (brand_id IS NULL) so the
// shared agency-demo seed data stays visible and the global-view demo keeps
// working. Called with no argument (logged-out/preview) it returns everything.
export async function listPrograms(brandId?: string | null): Promise<ProgramSummary[]> {
  const db = getBolticClient();
  const where = brandId ? `WHERE p.brand_id = $1 OR p.brand_id IS NULL` : '';
  return db.query<ProgramSummary>(
    `SELECT p.*, p.start_date::text AS start_date, p.end_date::text AS end_date,
            COUNT(pr.id)::int AS recruit_count,
            COUNT(pr.id) FILTER (WHERE pr.status = 'recruited')::int AS recruited_count,
            COALESCE(SUM(pr.rate) FILTER (WHERE pr.status <> 'declined'), 0)::float AS spent
     FROM programs p
     LEFT JOIN program_recruits pr ON pr.program_id = p.id
     ${where}
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    brandId ? [brandId] : undefined,
  );
}

/**
 * Ownership gate for a single program, mirroring creatorMayAccess on the
 * creator side. No brand session → preview/demo, always allowed. With a
 * session, a program owned by ANOTHER brand is denied; unassigned (null)
 * demo programs stay open to everyone.
 */
export function brandMayAccessProgram(
  programBrandId: string | null | undefined,
  sessionBrandId: string | null | undefined,
): boolean {
  if (!sessionBrandId) return true; // logged-out preview/demo
  if (!programBrandId) return true; // legacy/unassigned demo program
  return programBrandId === sessionBrandId;
}

export async function createProgram(input: {
  name: string;
  description?: string | null;
  requirements?: string | null;
  source_prompt?: string | null;
  brand_id?: string | null;
  budget?: number | null;
  start_date?: string | null;
  end_date?: string | null;
}): Promise<Program> {
  const db = getBolticClient();
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return db.insert<Program>('programs', {
    brand_id: input.brand_id ?? null,
    name: input.name,
    slug,
    description: input.description ?? null,
    requirements: input.requirements ?? null,
    source_prompt: input.source_prompt ?? null,
    status: 'active',
    budget: input.budget ?? null,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
  });
}

// Lightweight owner lookup for the sub-routes (recruits/submissions) that don't
// need the full program payload. Returns the brand_id, `null` when unassigned,
// or `undefined` when the program doesn't exist.
export async function getProgramBrandId(id: string): Promise<string | null | undefined> {
  const db = getBolticClient();
  const rows = await db.query<{ brand_id: string | null }>(
    `SELECT brand_id FROM programs WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows.length ? rows[0]!.brand_id : undefined;
}

/**
 * Route-level gate: may the current caller touch this program? Reads the brand
 * session itself, so routes just branch on the result. Returns:
 *   'not_found' — program id doesn't exist
 *   'forbidden' — belongs to a different brand than the signed-in one
 *   'ok'        — allowed (own program, unassigned demo, or logged-out preview)
 */
export async function guardBrandProgram(id: string): Promise<'ok' | 'not_found' | 'forbidden'> {
  const brandId = await getProgramBrandId(id);
  if (brandId === undefined) return 'not_found';
  const session = await getSession();
  return brandMayAccessProgram(brandId, session?.brand_id) ? 'ok' : 'forbidden';
}

export async function deleteProgram(id: string): Promise<boolean> {
  const db = getBolticClient();
  // program_recruits cascade-delete via FK (migration 005).
  const rows = await db.query<{ id: string }>(`DELETE FROM programs WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function getProgram(
  id: string,
): Promise<{ program: Program; recruits: ProgramRecruitView[]; spent: number } | null> {
  const db = getBolticClient();
  const programs = await db.query<Program>(
    `SELECT *, start_date::text AS start_date, end_date::text AS end_date FROM programs WHERE id = $1 LIMIT 1`,
    [id],
  );
  const program = programs[0];
  if (!program) return null;
  const recruits = await db.query<ProgramRecruitView>(
    `SELECT pr.*, pr.due_date::text AS due_date, c.handle, c.display_name, c.profile_url, c.profile_photo_url,
            c.follower_count, c.platform, c.genre, c.region, c.niche, c.quality_score
     FROM program_recruits pr
     JOIN creators c ON c.id = pr.creator_id
     WHERE pr.program_id = $1
     ORDER BY pr.created_at DESC`,
    [id],
  );
  // Spend = sum of agreed rates for everyone still in play (not declined).
  const spent = recruits
    .filter((r) => r.status !== 'declined')
    .reduce((s, r) => s + (Number(r.rate) || 0), 0);
  return { program, recruits, spent };
}

export async function updateProgram(input: {
  id: string;
  name?: string;
  description?: string | null;
  requirements?: string | null;
  status?: ProgramStatus;
  budget?: number | null;
  start_date?: string | null;
  end_date?: string | null;
}): Promise<Program | null> {
  const db = getBolticClient();
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) set.name = input.name;
  if (input.description !== undefined) set.description = input.description;
  if (input.requirements !== undefined) set.requirements = input.requirements;
  if (input.status !== undefined) set.status = input.status;
  if (input.budget !== undefined) set.budget = input.budget;
  if (input.start_date !== undefined) set.start_date = input.start_date;
  if (input.end_date !== undefined) set.end_date = input.end_date;
  const rows = await db.update<Program>('programs', { id: input.id }, set);
  return rows[0] ?? null;
}

// Recruit a creator into a program. Idempotent on (program_id, creator_id):
// a repeat recruit refreshes the score snapshot but NEVER resets an existing
// status back to 'invited' (so re-discovering someone you already recruited
// doesn't undo your pipeline progress).
export async function recruitToProgram(input: {
  program_id: string;
  creator_id: string;
  source_prompt?: string | null;
  relevance_score?: number | null;
  confidence_score?: number | null;
  note?: string | null;
}): Promise<ProgramRecruit> {
  const db = getBolticClient();
  const rows = await db.query<ProgramRecruit>(
    `INSERT INTO program_recruits
       (program_id, creator_id, status, source_prompt, relevance_score, confidence_score, note)
     VALUES ($1, $2, 'invited', $3, $4, $5, $6)
     ON CONFLICT (program_id, creator_id) DO UPDATE SET
       source_prompt    = COALESCE(program_recruits.source_prompt, EXCLUDED.source_prompt),
       relevance_score  = EXCLUDED.relevance_score,
       confidence_score = EXCLUDED.confidence_score,
       updated_at       = NOW()
     RETURNING *`,
    [
      input.program_id,
      input.creator_id,
      input.source_prompt ?? null,
      input.relevance_score ?? null,
      input.confidence_score ?? null,
      input.note ?? null,
    ],
  );
  return rows[0]!;
}

// Remove a creator from a program. The creator itself stays in the `creators`
// table (and in any other campaigns) — this only drops the program_recruits
// link for THIS program. Returns false when there was nothing to remove.
export async function removeRecruit(input: {
  program_id: string;
  creator_id: string;
}): Promise<boolean> {
  const db = getBolticClient();
  const rows = await db.query<{ id: string }>(
    `DELETE FROM program_recruits WHERE program_id = $1 AND creator_id = $2 RETURNING id`,
    [input.program_id, input.creator_id],
  );
  return rows.length > 0;
}

export async function updateRecruit(input: {
  program_id: string;
  creator_id: string;
  status?: RecruitStatus;
  note?: string | null;
  deliverables?: string | null;
  due_date?: string | null;
  rate?: number | null;
  paid?: boolean;
  payout_upi?: string | null;
}): Promise<ProgramRecruit | null> {
  const db = getBolticClient();
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status !== undefined) set.status = input.status;
  if (input.note !== undefined) set.note = input.note;
  if (input.deliverables !== undefined) set.deliverables = input.deliverables;
  if (input.due_date !== undefined) set.due_date = input.due_date;
  if (input.rate !== undefined) set.rate = input.rate;
  if (input.payout_upi !== undefined) set.payout_upi = input.payout_upi;
  if (input.paid !== undefined) {
    set.paid = input.paid;
    set.paid_at = input.paid ? new Date().toISOString() : null;
  }
  const rows = await db.update<ProgramRecruit>(
    'program_recruits',
    { program_id: input.program_id, creator_id: input.creator_id },
    set,
  );
  return rows[0] ?? null;
}

export interface PayoutRow {
  program_id: string;
  program_name: string;
  creator_id: string;
  handle: string;
  display_name: string | null;
  profile_url: string;
  status: RecruitStatus;
  rate: number | string | null;
  deliverables: string | null;
  due_date: string | null;
  paid: boolean;
  paid_at: string | null;
  payout_upi: string | null;
}

// Every non-declined recruit with a rate or recruited status — the payables list.
export async function listPayouts(): Promise<PayoutRow[]> {
  const db = getBolticClient();
  return db.query<PayoutRow>(
    `SELECT pr.program_id, p.name AS program_name, pr.creator_id,
            c.handle, c.display_name, c.profile_url,
            pr.status, pr.rate, pr.deliverables, pr.due_date::text AS due_date,
            pr.paid, pr.paid_at, pr.payout_upi
     FROM program_recruits pr
     JOIN programs p ON p.id = pr.program_id
     JOIN creators c ON c.id = pr.creator_id
     WHERE pr.status <> 'declined' AND (pr.rate IS NOT NULL OR pr.status = 'recruited')
     ORDER BY pr.paid ASC, p.created_at DESC, pr.created_at DESC`,
  );
}
