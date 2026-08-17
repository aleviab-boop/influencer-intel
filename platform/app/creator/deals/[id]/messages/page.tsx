'use client';

import { Suspense, use, useEffect, useState } from 'react';
import { DealMessageThread } from '@/components/deal-message-thread';

/**
 * Creator's side of the per-deal thread. The recruit id is the route param; the
 * handle (used to keep the creator session on the back link) rides the query,
 * mirroring the contract/invoice pages.
 */
export default function CreatorMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <CreatorMessagesView id={id} />
    </Suspense>
  );
}

function CreatorMessagesView({ id }: { id: string }) {
  const [handle, setHandle] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const h = (p.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h ? h.replace(/^@/, '') : null);
  }, []);

  const url = `/api/creator/deals/${encodeURIComponent(id)}/messages`;
  const backHref = `/creator/deals/${encodeURIComponent(id)}${handle ? `?handle=${encodeURIComponent(handle)}` : ''}`;

  return (
    <DealMessageThread
      getUrl={url}
      postUrl={url}
      backHref={backHref}
      backLabel="Deal"
      title="About this deal"
    />
  );
}
