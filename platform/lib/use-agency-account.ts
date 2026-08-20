'use client';

// Client hook for the signed-in agency account. Reads the httpOnly session cookie
// via /api/agency/me (the cookie itself is not JS-readable), and exposes a logout
// helper. `loading` distinguishes "checking" from "signed out" so pages don't
// flash the wrong state.

import { useCallback, useEffect, useState } from 'react';

export interface AgencyAccount {
  id: string;
  email: string;
  name: string | null;
  // 'brand' = a single brand that owns itself; 'agency' = manages many (mig 043).
  account_type?: 'agency' | 'brand';
}

export function useAgencyAccount() {
  const [account, setAccount] = useState<AgencyAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/agency/me', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      setAccount(d.account ?? null);
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/agency/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setAccount(null);
  }, []);

  return { account, loading, refresh, logout };
}
