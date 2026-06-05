// ============================================================
// Programs service — Discover & Recruit.
//
// A program is a named recruitment campaign. Influencers discovered via
// /api/discover are recruited into it and move through a status pipeline
// (invited → contacted → recruited → declined).
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import type { Program, ProgramRecruit, ProgramStatus, RecruitStatus } from '@influencer-intel/shared/types';

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

export async function listPrograms(): Promise<ProgramSummary[]> {
  const db = getBolticClient();
  return db.query<ProgramSummary>(
    `SELECT p.*,
            COUNT(pr.id)::int AS recruit_count,
            COUNT(pr.id) FILTER (WHERE pr.status = 'recruited')::int AS recruited_count,
            COALESCE(SUM(pr.rate) FILTER (WHERE pr.status <> 'declined'), 0)::float AS spent
     FROM programs p
     LEFT JOIN program_recruits pr ON pr.program_id = p.id
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
  );
}

export async function createProgram(input: {
  name: string;
  description?: string | null;
  source_prompt?: string | null;
  brand_id?: string | null;
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
    source_prompt: input.source_prompt ?? null,
    status: 'active',
  });
}

export async function getProgram(
  id: string,
): Promise<{ program: Program; recruits: ProgramRecruitView[]; spent: number } | null> {
  const db = getBolticClient();
  const program = await db.findById<Program>('programs', id);
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
  status?: ProgramStatus;
  budget?: number | null;
}): Promise<Program | null> {
  const db = getBolticClient();
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) set.name = input.name;
  if (input.status !== undefined) set.status = input.status;
  if (input.budget !== undefined) set.budget = input.budget;
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

export async function updateRecruit(input: {
  program_id: string;
  creator_id: string;
  status?: RecruitStatus;
  note?: string | null;
  deliverables?: string | null;
  due_date?: string | null;
  rate?: number | null;
  paid?: boolean;
}): Promise<ProgramRecruit | null> {
  const db = getBolticClient();
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status !== undefined) set.status = input.status;
  if (input.note !== undefined) set.note = input.note;
  if (input.deliverables !== undefined) set.deliverables = input.deliverables;
  if (input.due_date !== undefined) set.due_date = input.due_date;
  if (input.rate !== undefined) set.rate = input.rate;
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
}

// Every non-declined recruit with a rate or recruited status — the payables list.
export async function listPayouts(): Promise<PayoutRow[]> {
  const db = getBolticClient();
  return db.query<PayoutRow>(
    `SELECT pr.program_id, p.name AS program_name, pr.creator_id,
            c.handle, c.display_name, c.profile_url,
            pr.status, pr.rate, pr.deliverables, pr.due_date::text AS due_date,
            pr.paid, pr.paid_at
     FROM program_recruits pr
     JOIN programs p ON p.id = pr.program_id
     JOIN creators c ON c.id = pr.creator_id
     WHERE pr.status <> 'declined' AND (pr.rate IS NOT NULL OR pr.status = 'recruited')
     ORDER BY pr.paid ASC, p.created_at DESC, pr.created_at DESC`,
  );
}
