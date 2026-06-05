-- ============================================================
-- 005_programs.sql
--
-- "Discover & Recruit" (replicated from impact.com's programs model).
-- A program is a named recruitment campaign; influencers discovered via
-- /api/discover are recruited into it and move through a status pipeline.
--
--   programs          — named recruitment campaigns
--   program_recruits  — creators recruited into a program + their status
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS programs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID REFERENCES brands(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  slug          TEXT,
  description   TEXT,
  source_prompt TEXT,                              -- prompt the program was seeded from
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'closed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS program_recruits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  creator_id       UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,

  status           TEXT NOT NULL DEFAULT 'invited'
                     CHECK (status IN ('invited', 'contacted', 'recruited', 'declined')),
  source_prompt    TEXT,                           -- which discovery prompt surfaced them
  note             TEXT,
  relevance_score  NUMERIC(5,2),                   -- snapshot at recruit time
  confidence_score NUMERIC(5,2),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (program_id, creator_id)
);

CREATE INDEX IF NOT EXISTS idx_program_recruits_program ON program_recruits(program_id, status);
CREATE INDEX IF NOT EXISTS idx_program_recruits_creator ON program_recruits(creator_id);
