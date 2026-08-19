// ============================================================
// Agency roster — the set of brands an agency manages, kept client-side.
//
// A brand session (brand-session.ts) tracks the ONE brand currently open. An
// agency, though, handles several brands, so we keep a roster: every brand
// they've signed in gets remembered here (name + category + a cached copy of
// its DNA) so the workspace can offer a top-of-page dropdown to switch between
// them instantly — no re-analysis, no round-trip.
//
// Same design as brand-session: localStorage only (no auth backend yet),
// SSR-safe, and a custom event so same-tab writes re-render live. The DNA is
// still persisted server-side in brand_dna; this is a convenience cache.
// ============================================================

import { useEffect, useState } from 'react';
import type { BrandDnaProfile } from '@influencer-intel/shared/llm';
import { setBrandSession, getBrandSession, type BrandMode } from './brand-session';

export type { BrandDnaProfile };

const KEY = 'ii_agency_roster';
const EVENT = 'ii-agency-roster';
const MAX = 24;

export interface AgencyBrand {
  brand: string;
  url?: string | null;
  social?: string | null;
  category?: string | null;
  dna: BrandDnaProfile | null;
  ts: number; // when this brand was last opened
}

export function getAgencyRoster(): AgencyBrand[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as AgencyBrand[];
    return Array.isArray(v) ? v.filter((b) => b && typeof b.brand === 'string' && b.brand.length > 0) : [];
  } catch {
    return [];
  }
}

function write(brands: AgencyBrand[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(brands.slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* ignore quota / serialization errors */
  }
}

// Add (or refresh) a brand in the roster. Dedupes case-insensitively by name and
// keeps the most-recently-opened brand first.
export function addBrandToRoster(b: AgencyBrand): void {
  const key = b.brand.trim().toLowerCase();
  if (!key) return;
  const rest = getAgencyRoster().filter((x) => x.brand.trim().toLowerCase() !== key);
  write([{ ...b, ts: Date.now() }, ...rest]);
}

export function removeBrandFromRoster(name: string): void {
  const key = name.trim().toLowerCase();
  write(getAgencyRoster().filter((x) => x.brand.trim().toLowerCase() !== key));
}

// Open one of the agency's brands — restore its cached DNA into the active brand
// session, preserving the current barter/paid mode. The workspace re-renders for
// the newly-selected brand via the brand-session event.
export function switchToBrand(b: AgencyBrand): void {
  const mode: BrandMode = getBrandSession()?.mode ?? 'barter';
  setBrandSession({
    brand: b.brand,
    url: b.url ?? null,
    social: b.social ?? null,
    mode,
    dna: b.dna,
    ts: Date.now(),
  });
  addBrandToRoster(b); // bump to front
}

// React hook: live view of the roster, synced across same-tab writes (custom
// event) and other tabs (native storage event).
export function useAgencyRoster(): AgencyBrand[] {
  const [roster, setRoster] = useState<AgencyBrand[]>([]);
  useEffect(() => {
    const read = () => setRoster(getAgencyRoster());
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, []);
  return roster;
}
