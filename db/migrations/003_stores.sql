-- Store locations for region-based influencer targeting

CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name TEXT NOT NULL,
  store_code TEXT,
  city TEXT NOT NULL,
  state TEXT,
  region TEXT,
  pin_code TEXT,
  city_tier TEXT DEFAULT 'unknown',
  is_active BOOLEAN DEFAULT true,
  opened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stores_city ON stores(LOWER(city));
CREATE INDEX IF NOT EXISTS idx_stores_state ON stores(LOWER(state));
CREATE INDEX IF NOT EXISTS idx_stores_region ON stores(LOWER(region));
