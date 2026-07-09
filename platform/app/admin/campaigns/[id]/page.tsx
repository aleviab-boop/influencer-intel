'use client';

import { use } from 'react';
import { CampaignDetail } from '@/components/campaign-detail';

// Admin-shell campaign detail — reuses the shared <CampaignDetail> body so it
// stays in lockstep with the public /campaigns/[id] view; only the back link
// (and post-delete redirect) point back into the admin panel.
export default function AdminCampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="px-8 py-7 max-w-6xl mx-auto w-full font-sans">
      <CampaignDetail id={id} backHref="/admin/campaigns" />
    </div>
  );
}
