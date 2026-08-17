'use client';

import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ACCENT } from '@/components/marketing';
import { DealMessageThread } from '@/components/deal-message-thread';

/**
 * Brand's side of the per-deal thread. Keyed by (program, creator) like the
 * brand contract page, since the brand surfaces carry creator ids, not recruit
 * ids. The creator id rides the query string.
 */
export default function BrandMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <BrandMessagesView programId={id} />
    </Suspense>
  );
}

function BrandMessagesView({ programId }: { programId: string }) {
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setCreatorId((p.get('creator') || '').trim() || null);
    setReady(true);
  }, []);

  const backHref = `/campaigns/${encodeURIComponent(programId)}/submissions`;

  if (ready && !creatorId) {
    return (
      <div className="min-h-screen bg-[#f5f4f8] grid place-items-center px-6 font-sans">
        <div className="max-w-md text-center rounded-2xl bg-white border border-border shadow-card p-8">
          <div className="text-[16px] font-bold text-ink-900">Conversation unavailable</div>
          <p className="mt-2 text-[13px] text-ink-500">We couldn&rsquo;t find this deal. Open a conversation from the campaign&rsquo;s submissions.</p>
          <Link href={backHref} className="group mt-4 inline-flex items-center gap-1 text-[13px] font-semibold transition-colors" style={{ color: ACCENT }}><span className="inline-block transition-transform duration-300 group-hover:-translate-x-0.5">←</span> Back to campaign</Link>
        </div>
      </div>
    );
  }

  if (!creatorId) return null;

  const url = `/api/brand/messages?program=${encodeURIComponent(programId)}&creator=${encodeURIComponent(creatorId)}`;

  return (
    <DealMessageThread
      getUrl={url}
      postUrl={url}
      backHref={backHref}
      backLabel="Campaign"
      title="About this deal"
    />
  );
}
