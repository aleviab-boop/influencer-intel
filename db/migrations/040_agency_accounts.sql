-- ============================================================
-- 040: Agency accounts
--
-- Real email + password accounts for agencies (and single brands) so the brand
-- workspace stops being a purely client-side, localStorage affair. An agency
-- signs up once, then OWNS the brands it analyses: every brand_dna row is stamped
-- with the account that created it, so the roster / login list can be scoped to
-- "your brands" instead of every brand ever analysed on the platform.
--
-- Auth reuses the existing scrypt hashing (lib/auth.ts) and the HMAC-signed
-- stateless cookie scheme (no server-side session table needed) — same scheme as
-- the brand + creator sessions, one implementation, no drift.
-- ============================================================

CREATE TABLE IF NOT EXISTS agency_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  name           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive unique email (login is by lower(email)).
CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_accounts_email ON agency_accounts(lower(email));

-- Which account owns a saved brand DNA. Nullable so brands analysed before an
-- agency logged in (anonymous) still work; owned rows scope the roster.
ALTER TABLE brand_dna ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES agency_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_brand_dna_account ON brand_dna(account_id, created_at DESC);
