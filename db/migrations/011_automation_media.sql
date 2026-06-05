-- ============================================================
-- 011_automation_media.sql
-- Phase 2: target an automation at a specific Instagram post (media id),
-- so the comments webhook can match the right automation. Nullable —
-- a null media_id means "any post on this account".
-- Idempotent.
-- ============================================================
ALTER TABLE automations ADD COLUMN IF NOT EXISTS media_id TEXT;
