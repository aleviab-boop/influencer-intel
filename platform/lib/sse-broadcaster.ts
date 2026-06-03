// ============================================================
// In-memory SSE broadcaster — one channel per brief_id.
// (Single-instance only — for multi-instance, swap to Boltic NATS.)
// ============================================================

import type { ShortlistEvent } from '@influencer-intel/shared/types';

type Subscriber = (evt: ShortlistEvent) => void;

class SSEBroadcaster {
  private channels = new Map<string, Set<Subscriber>>();

  subscribe(briefId: string, fn: Subscriber): () => void {
    let set = this.channels.get(briefId);
    if (!set) {
      set = new Set();
      this.channels.set(briefId, set);
    }
    set.add(fn);
    return () => {
      const s = this.channels.get(briefId);
      s?.delete(fn);
      if (s && s.size === 0) this.channels.delete(briefId);
    };
  }

  emit(briefId: string, evt: ShortlistEvent): void {
    const set = this.channels.get(briefId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(evt);
      } catch (err) {
        console.error('[sse] subscriber threw', err);
      }
    }
  }
}

const broadcaster = new SSEBroadcaster();
export function getBroadcaster(): SSEBroadcaster {
  return broadcaster;
}
