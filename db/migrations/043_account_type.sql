-- ============================================================
-- 043: Distinguish brand-owned accounts from agencies
--
-- agency_accounts (040) was built for "agencies AND single brands" — same table,
-- same email/password + cookie scheme. Until now every row was implicitly an
-- agency (owns a roster of brands). We're adding a DEDICATED brand login: a brand
-- signs up for itself and owns exactly ONE brand (its own).
--
-- Under the hood it's still an agency_accounts row, so everything already scoped
-- to account_id (brand_dna, brand_pipeline, outreach_messages) works unchanged —
-- this is the "coexist" model: a brand owns itself, an agency owns many, both via
-- account_id. The only thing we need is a tag so the UI can tailor the flow
-- (a brand drops straight into its one workspace; an agency lands on the roster).
--
-- Default 'agency' so every existing row keeps its current behaviour.
-- ============================================================

ALTER TABLE agency_accounts
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'agency'
  CHECK (account_type IN ('agency', 'brand'));
