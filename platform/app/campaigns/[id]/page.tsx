'use client';

import { use } from 'react';
import { MarketingNav } from '@/components/marketing';
import { CampaignDetail } from '@/components/campaign-detail';

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <CampaignDetail id={id} backHref="/campaigns" />
      </main>
    </div>
  );
}
