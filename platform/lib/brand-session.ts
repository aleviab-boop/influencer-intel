// ============================================================
// Brand session — the signed-in brand's context, kept client-side.
//
// When a brand "logs in" on /brand-dna (name + website + social) we analyse them
// into a BrandDnaProfile and stash the whole context here. Every brand surface
// (the workspace home, campaign ideas, the scoped discovery bar) reads this so
// the experience is personalised to THIS brand — a protein brand sees protein/
// fitness campaigns, creators and trends, and the discovery bar remembers their
// niche instead of starting blank.
//
// Purely local (localStorage): no auth backend yet. The DNA itself is also
// persisted server-side in brand_dna, so this is a convenience cache, not the
// source of truth. SSR-safe — every accessor guards `window`.
// ============================================================

import { useEffect, useState } from 'react';
import type { BrandDnaProfile } from '@influencer-intel/shared/llm';

const KEY = 'ii_brand_session';
const EVENT = 'ii-brand-session';

export type BrandMode = 'barter' | 'paid';

export interface BrandSession {
  brand: string;
  url?: string | null;
  social?: string | null;
  mode: BrandMode;            // whether the brand runs barter or paid campaigns
  dna: BrandDnaProfile | null;
  ts: number;                 // when this session was last written
}

export function getBrandSession(): BrandSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as BrandSession;
    return v && typeof v.brand === 'string' && v.brand.length > 0 ? v : null;
  } catch {
    return null;
  }
}

// Persist a session and notify listeners in the same tab (the native `storage`
// event only fires in OTHER tabs, so we dispatch our own for this one).
export function setBrandSession(s: BrandSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...s, ts: Date.now() }));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export function updateBrandSession(patch: Partial<BrandSession>): BrandSession | null {
  const cur = getBrandSession();
  if (!cur) return null;
  const next = { ...cur, ...patch };
  setBrandSession(next);
  return next;
}

export function clearBrandSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* ignore */
  }
}

// React hook: live view of the session, synced across same-tab writes (custom
// event) and other tabs (native storage event).
export function useBrandSession(): BrandSession | null {
  const [session, setSession] = useState<BrandSession | null>(null);
  useEffect(() => {
    const read = () => setSession(getBrandSession());
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, []);
  return session;
}

// A discovery-bar seed built from the brand's DNA — keywords + category + the
// creator archetypes that fit — so the agency prompt bar opens already scoped to
// the brand's niche ("protein fitness nutrition micro creator" for a protein brand).
export function brandScopePrompt(s: BrandSession | null): string {
  if (!s) return '';
  const dna = s.dna;
  const parts = [
    dna?.category || '',
    ...(dna?.keywords ?? []).slice(0, 4),
    ...(dna?.creator_archetypes ?? []).slice(0, 2),
  ];
  return Array.from(new Set(parts.map((p) => p.trim()).filter(Boolean))).join(' ').slice(0, 120);
}
