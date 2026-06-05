// ============================================================
// Creator portal — the "For Influencers" side. Lets a creator look up their
// own profile by handle, browse open (active) brand campaigns, and self-apply.
// A self-application is a program_recruits row with status 'applied'
// (migration 014), which surfaces in the brand's campaign kanban.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';

const clean = (handle: string) => handle.trim().replace(/^@/, '').toLowerCase();

export interface CreatorProfile {
  id: string;
  handle: string;
  display_name: string | null;
  profile_photo_url: string | null;
  follower_count: number | string | null;
  engagement_rate: number | string | null;
  primary_category: string | null;
  primary_city: string | null;
  is_verified: boolean | null;
  quality_score: number | string | null;
  cred_score: string | null;
}

export async function findCreatorByHandle(handle: string): Promise<CreatorProfile | null> {
  const db = getBolticClient();
  const rows = await db.query<CreatorProfile>(
    `SELECT id, handle, display_name, profile_photo_url, follower_count, engagement_rate,
            primary_category, primary_city, is_verified, quality_score,
            credibility->>'overall_score' AS cred_score
     FROM creators
     WHERE LOWER(handle) = $1 AND is_active = true
     LIMIT 1`,
    [clean(handle)],
  );
  return rows[0] ?? null;
}

export interface OpenCampaign {
  id: string;
  name: string;
  description: string | null;
  budget: number | string | null;
  created_at: string;
  recruit_count: number;
}

export async function listOpenCampaigns(): Promise<OpenCampaign[]> {
  const db = getBolticClient();
  return db.query<OpenCampaign>(
    `SELECT p.id, p.name, p.description, p.budget, p.created_at::text AS created_at,
            COUNT(pr.id)::int AS recruit_count
     FROM programs p
     LEFT JOIN program_recruits pr ON pr.program_id = p.id
     WHERE p.status = 'active'
     GROUP BY p.id
     ORDER BY p.created_at DESC
     LIMIT 50`,
  );
}

export interface CreatorApplication {
  program_id: string;
  program_name: string;
  description: string | null;
  status: string;
  created_at: string;
}

export async function getCreatorApplications(handle: string): Promise<CreatorApplication[]> {
  const db = getBolticClient();
  return db.query<CreatorApplication>(
    `SELECT pr.program_id, p.name AS program_name, p.description, pr.status, pr.created_at::text AS created_at
     FROM program_recruits pr
     JOIN programs p ON p.id = pr.program_id
     JOIN creators c ON c.id = pr.creator_id
     WHERE LOWER(c.handle) = $1
     ORDER BY pr.created_at DESC`,
    [clean(handle)],
  );
}

// Self-apply. Idempotent on (program_id, creator_id): if a row already exists
// (e.g. the brand already invited them, or they applied before), leave it.
export async function applyToProgram(handle: string, programId: string): Promise<{ already: boolean; status: string }> {
  const db = getBolticClient();
  const creator = await findCreatorByHandle(handle);
  if (!creator) throw new Error('creator not found');

  const existing = await db.query<{ status: string }>(
    `SELECT status FROM program_recruits WHERE program_id = $1 AND creator_id = $2 LIMIT 1`,
    [programId, creator.id],
  );
  if (existing[0]) return { already: true, status: existing[0].status };

  await db.insert('program_recruits', {
    program_id: programId,
    creator_id: creator.id,
    status: 'applied',
    note: 'Applied via creator portal',
  });
  return { already: false, status: 'applied' };
}
