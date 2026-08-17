-- ============================================================
-- 033: Creator Insights-screenshot proofs
--
-- The 'screenshot' rung of the verification ladder (see migration 032). A creator
-- uploads an Instagram Insights screenshot as proof of their reach/audience — a
-- step up from the login-free public auto-fill, and still WITHOUT the Meta App
-- Review gate. We have no object storage in this app, so the image is kept inline
-- as a base64 data-URL (size-capped by the upload route). One row per creator:
-- the latest upload wins (ON CONFLICT DO UPDATE).
--
--   status  submitted — on file, tier bumped to 'screenshot'
--           approved  — a human/brand confirmed it (optional later rung)
--           rejected  — didn't check out; route may drop the tier back down
-- ============================================================

CREATE TABLE IF NOT EXISTS creator_insight_proofs (
  creator_id   UUID PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  image_data   TEXT NOT NULL,                         -- data:image/...;base64,....
  mime_type    TEXT NOT NULL,
  byte_size    INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'submitted'
                 CHECK (status IN ('submitted', 'approved', 'rejected')),
  note         TEXT,                                  -- optional reviewer note
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
