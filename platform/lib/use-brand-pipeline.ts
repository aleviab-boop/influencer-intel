'use client';

// ============================================================
// Client hook for a brand's creator pipeline (the agency-owned funnel).
//
// Scoped to one brand name; every call rides the httpOnly agency-session cookie,
// so a signed-out user gets `needsAuth` (a nudge to create an account) rather
// than a silent no-op. Optimistic-ish: mutations refetch the list so the panel
// and the "Saved ✓" buttons on creator cards stay in sync.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';

export const PIPELINE_STATUSES = ['saved', 'contacted', 'replied', 'negotiating', 'won', 'passed'] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export interface PipelineItem {
  id: string;
  brand: string;
  handle: string;
  creator_id: string | null;
  snapshot: Record<string, unknown> | null;
  status: PipelineStatus;
  note: string | null;
  added_at: string;
  updated_at: string;
}

export interface SaveCreatorInput {
  handle: string;
  creator_id?: string | null;
  snapshot?: Record<string, unknown> | null;
  note?: string | null;
}

export function useBrandPipeline(brand: string | null | undefined) {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

  const refresh = useCallback(async () => {
    const b = brand?.trim();
    if (!b) { setItems([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/brand/pipeline?brand=${encodeURIComponent(b)}`, { cache: 'no-store' });
      if (r.status === 401) { setNeedsAuth(true); setItems([]); return; }
      setNeedsAuth(false);
      const d = await r.json().catch(() => ({}));
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [brand]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Fast membership lookup for "Save / Saved ✓" buttons.
  const savedHandles = useMemo(
    () => new Set(items.map((i) => i.handle.toLowerCase())),
    [items],
  );
  const has = useCallback((handle: string) => savedHandles.has(handle.trim().replace(/^@/, '').toLowerCase()), [savedHandles]);

  const save = useCallback(async (input: SaveCreatorInput): Promise<boolean> => {
    const b = brand?.trim();
    if (!b || !input.handle) return false;
    try {
      const r = await fetch('/api/brand/pipeline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brand: b, ...input }),
      });
      if (r.status === 401) { setNeedsAuth(true); return false; }
      if (!r.ok) return false;
      await refresh();
      return true;
    } catch {
      return false;
    }
  }, [brand, refresh]);

  const updateStatus = useCallback(async (handle: string, status: PipelineStatus): Promise<boolean> => {
    const b = brand?.trim();
    if (!b) return false;
    try {
      const r = await fetch('/api/brand/pipeline', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brand: b, handle, status }),
      });
      if (r.status === 401) { setNeedsAuth(true); return false; }
      if (!r.ok) return false;
      await refresh();
      return true;
    } catch {
      return false;
    }
  }, [brand, refresh]);

  const updateNote = useCallback(async (handle: string, note: string): Promise<boolean> => {
    const b = brand?.trim();
    if (!b) return false;
    try {
      const r = await fetch('/api/brand/pipeline', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brand: b, handle, note }),
      });
      if (r.status === 401) { setNeedsAuth(true); return false; }
      if (!r.ok) return false;
      await refresh();
      return true;
    } catch {
      return false;
    }
  }, [brand, refresh]);

  const remove = useCallback(async (handle: string): Promise<boolean> => {
    const b = brand?.trim();
    if (!b) return false;
    try {
      const r = await fetch(`/api/brand/pipeline?brand=${encodeURIComponent(b)}&handle=${encodeURIComponent(handle)}`, {
        method: 'DELETE',
      });
      if (r.status === 401) { setNeedsAuth(true); return false; }
      if (!r.ok) return false;
      await refresh();
      return true;
    } catch {
      return false;
    }
  }, [brand, refresh]);

  return { items, loading, needsAuth, has, save, updateStatus, updateNote, remove, refresh };
}
