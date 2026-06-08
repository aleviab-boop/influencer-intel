-- ============================================================
-- 015_demo_leads.sql
-- Capture "Book a demo" requests from the marketing site. Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS demo_leads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  company     TEXT NOT NULL,
  team_size   TEXT,
  goal        TEXT,
  source      TEXT NOT NULL DEFAULT 'book_demo',
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demo_leads_created ON demo_leads(created_at DESC);
