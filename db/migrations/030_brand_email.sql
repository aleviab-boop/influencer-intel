-- ============================================================
-- 030: Brand contact email
--
-- The brand's login email, stored explicitly so we can email THEM (e.g. when a
-- creator accepts or declines a campaign invite). Historically the email was
-- only encoded lossily into `slug` (dots and @ both become '_'), so it can't be
-- reversed — this column is the source of truth going forward.
--
-- Backfilled best-effort from the brands.users JSONB (first user's email) where
-- present; otherwise populated on the brand's next sign-in (see lib/auth.ts).
-- ============================================================

ALTER TABLE brands ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE brands
   SET email = (users::jsonb)->0->>'email'
 WHERE email IS NULL
   AND jsonb_typeof(users::jsonb) = 'array'
   AND (users::jsonb)->0->>'email' IS NOT NULL;
