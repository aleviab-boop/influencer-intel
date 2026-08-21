'use client';

import { useState } from 'react';

// Creator avatar with the app's standard fallback chain. Ordered by reliability:
//   1. /api/ig-avatar?handle= — DB-cached photo that self-refreshes when the
//      cached CDN URL has expired. This is the SOURCE OF TRUTH and works even
//      for creators we've never stored a direct URL for.
//   2. /api/ig-image?u=<pic> — the stored CDN URL passed inline, only as a
//      secondary (those signed URLs expire, so trying them first caused a broken-
//      image flash before the real photo loaded).
//   3. A deterministic gradient initial when both are unavailable.
// `stage` advances on each <img> error.
//
// Shared across every surface that renders a creator photo (brand workspace,
// campaigns, search, database, insights, predict) so the fallback behaves the
// same everywhere. Size/shape is controlled by `className`; the gradient initial
// inherits it too.
export function CreatorAvatar({
  handle,
  name,
  pic,
  className = 'w-9 h-9',
}: {
  handle: string;
  name?: string | null;
  pic?: string | null;
  className?: string;
}) {
  const [stage, setStage] = useState(0);
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;

  const src =
    stage === 0
      ? `/api/ig-avatar?handle=${encodeURIComponent(handle)}`
      : stage === 1 && pic
        ? `/api/ig-image?u=${encodeURIComponent(pic)}`
        : null;

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={handle}
        onError={() => setStage((s) => s + 1)}
        className={`${className} rounded-full object-cover shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${className} rounded-full shrink-0 grid place-items-center text-white text-[13px] font-semibold`}
      style={{ background: `linear-gradient(135deg, hsl(${h % 360} 55% 62%), hsl(${(h + 50) % 360} 55% 50%))` }}
    >
      {(name || handle).charAt(0).toUpperCase()}
    </div>
  );
}
