-- Add Instagram handle to brands for self-tracking
ALTER TABLE brands ADD COLUMN IF NOT EXISTS ig_handle TEXT;
CREATE INDEX IF NOT EXISTS idx_brands_ig_handle ON brands(ig_handle) WHERE ig_handle IS NOT NULL;
