'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';

interface StoreRow {
  id: string;
  store_name: string;
  store_code: string | null;
  city: string;
  state: string | null;
  region: string | null;
  pin_code: string | null;
  city_tier: string | null;
  is_active: boolean;
}

interface InfluencerResult {
  id: string;
  handle: string;
  display_name: string | null;
  profile_photo_url: string | null;
  follower_count: number | null;
  engagement_rate: number | null;
  primary_category: string | null;
  primary_city: string | null;
  bio: string | null;
  is_verified: boolean;
  cred_score: string | null;
  cred_badge: string | null;
  has_paid_partnership: boolean;
  audience_pct_in_city: number;
  relevance_score: number;
}

type Region = '' | 'north' | 'south' | 'east' | 'west';

export default function StoresPage() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [influencers, setInfluencers] = useState<InfluencerResult[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [region, setRegion] = useState<Region>('');
  const [loading, setLoading] = useState(false);
  const [influencerLoading, setInfluencerLoading] = useState(false);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [resultCity, setResultCity] = useState('');

  // New store launch form
  const [launchCity, setLaunchCity] = useState('');
  const [launchState, setLaunchState] = useState('');
  const [launchCategory, setLaunchCategory] = useState('');

  // CSV upload state
  const [uploadStatus, setUploadStatus] = useState('');

  // Load stores
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchQ.trim()) params.set('q', searchQ.trim());
    if (region) params.set('region', region);

    const ctrl = new AbortController();
    fetch(`/api/stores?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setStores(d.stores ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [searchQ, region]);

  function handleStoreClick(store: StoreRow) {
    setActiveStoreId(store.id);
    setResultCity(store.city);
    setInfluencerLoading(true);
    fetch(`/api/stores/${store.id}/influencers`)
      .then((r) => r.json())
      .then((d) => setInfluencers(d.influencers ?? []))
      .catch(() => setInfluencers([]))
      .finally(() => setInfluencerLoading(false));
  }

  function handleLaunchSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!launchCity.trim()) return;
    setActiveStoreId(null);
    setResultCity(launchCity.trim());
    setInfluencerLoading(true);
    fetch('/api/stores/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        city: launchCity.trim(),
        state: launchState.trim() || undefined,
        category: launchCategory || undefined,
        limit: 50,
      }),
    })
      .then((r) => r.json())
      .then((d) => setInfluencers(d.influencers ?? []))
      .catch(() => setInfluencers([]))
      .finally(() => setInfluencerLoading(false));
  }

  function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus('Parsing...');

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.split('\n').filter((l) => l.trim());
        if (lines.length < 2) {
          setUploadStatus('CSV must have a header + at least 1 row');
          return;
        }

        const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
        const cityIdx = header.indexOf('city');
        const nameIdx = header.indexOf('store_name');
        if (cityIdx === -1 || nameIdx === -1) {
          setUploadStatus('CSV must have store_name and city columns');
          return;
        }

        const stateIdx = header.indexOf('state');
        const regionIdx = header.indexOf('region');
        const codeIdx = header.indexOf('store_code');
        const pinIdx = header.indexOf('pin_code');

        const parsed = lines.slice(1).map((line) => {
          const cols = line.split(',').map((c) => c.trim().replace(/^['"]|['"]$/g, ''));
          return {
            store_name: cols[nameIdx] ?? '',
            city: cols[cityIdx] ?? '',
            state: stateIdx >= 0 ? cols[stateIdx] : undefined,
            region: regionIdx >= 0 ? cols[regionIdx] : undefined,
            store_code: codeIdx >= 0 ? cols[codeIdx] : undefined,
            pin_code: pinIdx >= 0 ? cols[pinIdx] : undefined,
          };
        }).filter((s) => s.store_name && s.city);

        setUploadStatus(`Uploading ${parsed.length} stores...`);

        const res = await fetch('/api/stores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stores: parsed }),
        });
        const data = await res.json();
        if (res.ok) {
          setUploadStatus(`Imported ${data.imported} stores`);
          // Refresh store list
          setSearchQ((q) => q + ' ');
          setTimeout(() => setSearchQ((q) => q.trimEnd()), 100);
        } else {
          setUploadStatus(data.error ?? 'Import failed');
        }
      } catch {
        setUploadStatus('Failed to parse CSV');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <main className="min-h-screen bg-white">
      <AppHeader />

      <section className="max-w-5xl mx-auto px-6 pt-10 pb-4">
        <h1 className="text-2xl font-light text-[#111] mb-1">Store-Based Targeting</h1>
        <p className="text-[13px] text-[#999]">
          Find influencers popular near your stores
        </p>
      </section>

      {/* Search + filters */}
      <section className="max-w-5xl mx-auto px-6 pb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search city or store name..."
            className="flex-1 px-4 py-2.5 border border-[#e5e5e5] text-[14px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#111] transition-colors"
          />
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as Region)}
            className="px-3 py-2.5 border border-[#e5e5e5] text-[13px] text-[#6b6b6b] bg-white focus:outline-none focus:border-[#111]"
          >
            <option value="">All regions</option>
            <option value="north">North</option>
            <option value="south">South</option>
            <option value="east">East</option>
            <option value="west">West</option>
          </select>
          <label className="px-4 py-2.5 border border-[#e5e5e5] text-[13px] text-[#999] hover:text-[#111] hover:border-[#ccc] cursor-pointer transition-colors">
            Upload CSV
            <input type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
          </label>
        </div>
        {uploadStatus && (
          <div className="mt-2 text-[12px] text-[#999]">{uploadStatus}</div>
        )}
      </section>

      {/* New store launch */}
      <section className="max-w-5xl mx-auto px-6 pb-6">
        <div className="border border-[#e5e5e5] p-5">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[#999] mb-3">
            New Store Launch
          </div>
          <form onSubmit={handleLaunchSearch} className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="text-[11px] uppercase tracking-[0.06em] text-[#ccc] mb-1 block">City</label>
              <input
                type="text"
                value={launchCity}
                onChange={(e) => setLaunchCity(e.target.value)}
                placeholder="Mumbai"
                required
                className="w-full px-3 py-2 border border-[#e5e5e5] text-[14px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#111] transition-colors"
              />
            </div>
            <div className="w-48">
              <label className="text-[11px] uppercase tracking-[0.06em] text-[#ccc] mb-1 block">State</label>
              <input
                type="text"
                value={launchState}
                onChange={(e) => setLaunchState(e.target.value)}
                placeholder="Maharashtra"
                className="w-full px-3 py-2 border border-[#e5e5e5] text-[14px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#111] transition-colors"
              />
            </div>
            <div className="w-36">
              <label className="text-[11px] uppercase tracking-[0.06em] text-[#ccc] mb-1 block">Category</label>
              <select
                value={launchCategory}
                onChange={(e) => setLaunchCategory(e.target.value)}
                className="w-full px-3 py-2 border border-[#e5e5e5] text-[13px] text-[#6b6b6b] bg-white focus:outline-none focus:border-[#111]"
              >
                <option value="">Any</option>
                <option value="fashion">Fashion</option>
                <option value="beauty">Beauty</option>
                <option value="lifestyle">Lifestyle</option>
                <option value="food">Food</option>
                <option value="fitness">Fitness</option>
                <option value="travel">Travel</option>
                <option value="tech">Tech</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={influencerLoading}
              className="px-5 py-2 bg-[#111] text-white text-[13px] hover:bg-[#333] disabled:opacity-50 transition-colors"
            >
              {influencerLoading ? 'Searching...' : 'Find Influencers'}
            </button>
          </form>
        </div>
      </section>

      {/* Results */}
      {(influencers.length > 0 || influencerLoading) && (
        <section className="max-w-5xl mx-auto px-6 pb-8">
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[#999]">Results</span>
            {resultCity && (
              <span className="text-[13px] text-[#111]">
                {influencers.length} influencers near {resultCity}
              </span>
            )}
          </div>

          {influencerLoading ? (
            <div className="text-[#ccc] text-sm py-10 text-center">Loading...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-[#e5e5e5] border border-[#e5e5e5]">
              {influencers.map((inf) => (
                <InfluencerTile key={inf.id} inf={inf} city={resultCity} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Store list */}
      {stores.length > 0 && (
        <section className="max-w-5xl mx-auto px-6 pb-16">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[#999] mb-3">
            Your Stores ({stores.length})
          </div>
          <div className="border border-[#e5e5e5] divide-y divide-[#e5e5e5]">
            {stores.map((s) => (
              <button
                key={s.id}
                onClick={() => handleStoreClick(s)}
                className={`w-full px-5 py-3.5 flex items-center gap-4 text-left hover:bg-[#fafafa] transition-colors ${
                  activeStoreId === s.id ? 'bg-[#fafafa]' : 'bg-white'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] text-[#111] font-medium truncate">{s.store_name}</div>
                  <div className="text-[12px] text-[#999] mt-0.5">
                    {[s.city, s.state, s.region].filter(Boolean).join(', ')}
                  </div>
                </div>
                {s.store_code && (
                  <span className="text-[11px] text-[#ccc] tabular-nums">{s.store_code}</span>
                )}
                {s.city_tier && s.city_tier !== 'unknown' && (
                  <span className="text-[11px] uppercase tracking-[0.06em] text-[#999]">{s.city_tier}</span>
                )}
                <span className="text-[11px] text-[#ccc]">Find &rarr;</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!loading && stores.length === 0 && influencers.length === 0 && !influencerLoading && (
        <section className="max-w-5xl mx-auto px-6 pb-16">
          <div className="border border-[#e5e5e5] p-10 text-center">
            <p className="text-[#999] text-sm mb-2">No stores loaded yet</p>
            <p className="text-[#ccc] text-[12px]">
              Upload a CSV with store_name and city columns, or use the form above to find influencers for a new store launch.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function InfluencerTile({ inf, city }: { inf: InfluencerResult; city: string }) {
  const followers = Number(inf.follower_count ?? 0);
  const er = inf.engagement_rate != null ? Number(inf.engagement_rate) : null;

  return (
    <Link
      href={`/insights/${encodeURIComponent(inf.handle)}`}
      className="bg-white p-5 hover:bg-[#fafafa] transition-colors block group"
    >
      <div className="flex items-start gap-3 mb-3">
        <Avatar src={inf.profile_photo_url} handle={inf.handle} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-medium text-[#111] truncate">@{inf.handle}</span>
            {inf.is_verified && <VerifiedDot />}
          </div>
          {inf.display_name && <div className="text-[12px] text-[#999] truncate">{inf.display_name}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[15px] font-semibold text-[#111] tabular-nums">{inf.relevance_score}</div>
          <div className="text-[10px] uppercase tracking-wider text-[#ccc]">Score</div>
        </div>
      </div>

      <div className="flex items-baseline gap-4 text-[13px] mb-2">
        <span className="text-[#111] tabular-nums">{formatK(followers)}</span>
        {er != null && <span className="text-[#999] tabular-nums">{(er * 100).toFixed(1)}% ER</span>}
        {inf.cred_score && (
          <span className={`text-[12px] tabular-nums ${
            inf.cred_badge === 'green' ? 'text-green-600' :
            inf.cred_badge === 'amber' ? 'text-amber-600' : 'text-red-500'
          }`}>
            {inf.cred_score}
          </span>
        )}
      </div>

      {inf.audience_pct_in_city > 0 && (
        <div className="text-[12px] text-[#111] mb-2 tabular-nums">
          {inf.audience_pct_in_city}% audience in {city}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {inf.primary_category && (
          <span className="text-[11px] text-[#999] uppercase tracking-[0.06em]">{inf.primary_category}</span>
        )}
        {inf.primary_city && (
          <span className="text-[11px] text-[#ccc]">{inf.primary_city}</span>
        )}
        {inf.has_paid_partnership && (
          <span className="text-[10px] text-[#999] tracking-wide">BRAND EXP</span>
        )}
        <span className="ml-auto text-[11px] text-[#ccc] opacity-0 group-hover:opacity-100 transition-opacity">
          View &rarr;
        </span>
      </div>
    </Link>
  );
}

function Avatar({ src, handle }: { src: string | null; handle: string }) {
  const [error, setError] = useState(false);
  if (src && !error) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={handle}
        referrerPolicy="no-referrer"
        onError={() => setError(true)}
        className="w-9 h-9 rounded-full object-cover grayscale"
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-[#f0f0f0] flex items-center justify-center text-[#999] text-[12px] font-medium shrink-0">
      {handle[0]?.toUpperCase()}
    </div>
  );
}

function VerifiedDot() {
  return <span className="w-1.5 h-1.5 rounded-full bg-[#111] shrink-0" title="Verified" />;
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
