'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { buildSuggestions } from '@/lib/suggestions';

const ACCENT = '#6C4DF6';
const ACCENT_SOFT = '#F4F2FF';

interface LiveProfile {
  username: string;
  full_name: string;
  biography: string;
  category: string;
  followers: number;
  is_private: boolean;
  is_verified: boolean;
  profile_pic_url: string | null;
  score: number;
  engagement?: number;
  email?: string | null;
  phone?: string | null;
  link?: string | null;
  creator_id?: string;
  from?: 'db' | 'live';
}

interface Program {
  id: string;
  name: string;
}

// A creator the user pinned to revisit — persisted client-side so finds aren't
// lost while pivoting through the similar-creators discovery graph. Works for
// live-crawled creators too (which have no creator_id for campaign recruiting).
interface SavedCreator {
  username: string;
  full_name: string;
  followers: number;
  profile_pic_url: string | null;
  category?: string;
  email?: string | null;
  phone?: string | null;
}

interface ProfileData {
  handle: string;
  full_name: string;
  biography: string;
  category: string;
  followers: number;
  following: number;
  posts: number;
  is_verified: boolean;
  is_private: boolean;
  profile_pic_url: string | null;
  external_url: string | null;
  email: string | null;
  phone: string | null;
  recent: { shortcode: string; thumbnail: string | null; likes: number; comments: number; is_video: boolean; taken_at: number | null; caption: string }[];
  related?: { handle: string; full_name: string; is_verified: boolean; profile_pic_url: string | null }[];
  collabs?: { handle: string; count: number }[];
  sponsored_posts?: number;
}

interface RunResponse {
  prompt: string;
  tokens: string[];
  seeds: string[];
  results: LiveProfile[];
  persisted: number;
  resolved_from_names?: Array<{ name: string; handle: string; followers: number }>;
  auto_seeds?: Array<{ handle: string; followers: number }>;
  from_db?: number;
  from_live?: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Compact Indian-rupee format for sponsored-post rates (₹1.2L, ₹45K, ₹800).
function inr(n: number): string {
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(n >= 10_00_000 ? 0 : 1)}L`;
  if (n >= 1_000) return `₹${Math.round(n / 1_000)}K`;
  return `₹${Math.round(n / 100) * 100}`;
}

// Rising star = a modest-sized creator punching well above their tier's
// engagement floor — the kind worth signing before they get expensive.
function isRisingStar(followers: number, engagement: number | null): boolean {
  if (engagement == null || followers <= 0) return false;
  return followers < 250_000 && engagement >= expectedErFloor(followers) * 1.6;
}

// Lightweight follower-growth tracking via localStorage. We snapshot followers
// on each profile view; on a later view we can show the delta since first seen.
interface GrowthSnap { f: number; t: number }
function readGrowth(handle: string): GrowthSnap[] {
  try {
    const all = JSON.parse(localStorage.getItem('ii_growth') ?? '{}');
    return Array.isArray(all[handle.toLowerCase()]) ? all[handle.toLowerCase()] : [];
  } catch {
    return [];
  }
}
function recordGrowth(handle: string, followers: number): void {
  if (followers <= 0) return;
  try {
    const all = JSON.parse(localStorage.getItem('ii_growth') ?? '{}');
    const key = handle.toLowerCase();
    const list: GrowthSnap[] = Array.isArray(all[key]) ? all[key] : [];
    const last = list[list.length - 1];
    // Skip if we already logged this count within the last 12h (avoid noise).
    if (last && last.f === followers && Date.now() - last.t < 12 * 3_600_000) return;
    list.push({ f: followers, t: Date.now() });
    all[key] = list.slice(-8); // keep recent history
    localStorage.setItem('ii_growth', JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

// Rough sponsored-post rate range (single IG in-feed post, India market).
// Rate-per-1k-followers tapers as audiences scale; healthy engagement commands
// a premium, weak engagement a discount. Heuristic — a starting point, not a quote.
function estimatedRate(
  followers: number,
  engagement: number | null,
): { low: number; high: number } | null {
  if (followers < 500) return null;
  const per1k =
    followers >= 500_000 ? [300, 600]
    : followers >= 100_000 ? [400, 750]
    : followers >= 50_000 ? [500, 900]
    : [600, 1100];
  const floor = expectedErFloor(followers);
  const factor =
    engagement == null ? 1 : engagement >= floor * 1.5 ? 1.25 : engagement >= floor ? 1.1 : 0.8;
  const k = followers / 1000;
  return { low: Math.round(k * per1k[0]! * factor), high: Math.round(k * per1k[1]! * factor) };
}

// Rough authenticity read: engagement that's far below the healthy floor for a
// creator's follower tier is a fake-follower warning sign. null = unknown ER.
function expectedErFloor(followers: number): number {
  if (followers >= 1_000_000) return 0.7;
  if (followers >= 100_000) return 1.0;
  if (followers >= 10_000) return 1.5;
  return 2.0;
}
function authenticityFlag(followers: number, engagement?: number): 'healthy' | 'low' | null {
  if (!engagement || engagement <= 0) return null;
  return engagement >= expectedErFloor(followers) ? 'healthy' : 'low';
}

// Posting rhythm from recent-post timestamps + engagement. IG timestamps are
// UTC; we read them in IST (UTC+5:30) since the audience is India-first. Returns
// posts/week, the highest-engagement weekday, and a 3-hour best-time window.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function postingInsight(
  recent: { likes: number; comments: number; taken_at: number | null }[],
): { cadence: string; bestDay: string; bestWindow: string } | null {
  const ts = recent.filter((p) => p.taken_at && p.taken_at > 0);
  if (ts.length < 3) return null;

  const times = ts.map((p) => p.taken_at!).sort((a, b) => b - a);
  const spanDays = (times[0]! - times[times.length - 1]!) / 86_400;
  const perWeek = spanDays > 0 ? (times.length - 1) / (spanDays / 7) : 0;
  const cadence =
    perWeek >= 6 ? 'Posts daily'
    : perWeek >= 1 ? `~${Math.round(perWeek)}× / week`
    : `~${Math.max(1, Math.round(perWeek * 4))}× / month`;

  // IST = UTC + 5h30m → shift seconds before reading day/hour in UTC fields.
  const dayEng = new Array(7).fill(0);
  const hourEng = new Array(24).fill(0);
  for (const p of ts) {
    const d = new Date((p.taken_at! + 5.5 * 3600) * 1000);
    const eng = p.likes + p.comments;
    dayEng[d.getUTCDay()] += eng;
    hourEng[d.getUTCHours()] += eng;
  }
  const bestDayIdx = dayEng.indexOf(Math.max(...dayEng));
  const bestHour = hourEng.indexOf(Math.max(...hourEng));
  const fmtHr = (h: number) => {
    const hh = ((h + 24) % 24);
    const ampm = hh < 12 ? 'am' : 'pm';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}${ampm}`;
  };
  return {
    cadence,
    bestDay: DAYS[bestDayIdx]!,
    bestWindow: `${fmtHr(bestHour - 1)}–${fmtHr(bestHour + 2)} IST`,
  };
}

// Content themes: the hashtags a creator leans on most across recent captions —
// a quick read on what they actually post about, for brand-fit judgement.
function contentThemes(
  recent: { caption: string }[],
  limit = 6,
): string[] {
  const counts = new Map<string, number>();
  for (const p of recent) {
    const tags = p.caption?.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    for (const raw of tags) {
      const tag = raw.toLowerCase();
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

// Split the start-from field into exact handles vs names to resolve.
// Comma-separated; an entry with an internal space is treated as a name
// (e.g. "mridul sharma"), otherwise as an @handle.
// Click-to-send links: WhatsApp prefilled (Indian numbers default to +91) and
// a mailto with the draft as the body.
function waLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '');
  const withCc = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCc}?text=${encodeURIComponent(text)}`;
}
function mailLink(email: string, text: string): string {
  return `mailto:${email}?subject=${encodeURIComponent('Collaboration with you')}&body=${encodeURIComponent(text)}`;
}

function parseSeedInput(raw: string): { seeds: string[]; names: string[] } {
  const seeds: string[] = [];
  const names: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim().replace(/^@/, '');
    if (!entry) continue;
    if (/\s/.test(entry)) names.push(entry);
    else if (/^[a-z0-9._]+$/i.test(entry)) seeds.push(entry.toLowerCase());
    else names.push(entry);
  }
  return { seeds, names };
}

export function LiveSearch({
  initialPrompt = '',
  initialSeed = '',
  initialMode = 'live',
}: {
  initialPrompt?: string;
  initialSeed?: string;
  initialMode?: 'db' | 'live';
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [seedText, setSeedText] = useState(initialSeed);
  const [needSeed, setNeedSeed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  // result filters / sort
  const [minFollowers, setMinFollowers] = useState(0);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [healthyOnly, setHealthyOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'relevance' | 'followers_desc' | 'followers_asc' | 'engagement'>('relevance');
  // shortlist / recruit
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState('');
  const [recruited, setRecruited] = useState<Record<string, string>>({});
  const [recruiting, setRecruiting] = useState<string | null>(null);
  // outreach draft modal
  const [draftFor, setDraftFor] = useState<LiveProfile | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftChannel, setDraftChannel] = useState<'dm' | 'email'>('dm');
  const [draftLang, setDraftLang] = useState<'auto' | 'english' | 'hinglish' | 'hindi'>('auto');
  const [draftFollowup, setDraftFollowup] = useState(false);
  const [copied, setCopied] = useState(false);
  // bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // bulk outreach drafts
  const [bulkDraft, setBulkDraft] = useState<{ username: string; message: string; phone?: string | null; email?: string | null }[] | null>(null);
  const [bulkDraftLoading, setBulkDraftLoading] = useState(false);
  const [bulkChannel, setBulkChannel] = useState<'dm' | 'email'>('dm');
  const [bulkCopied, setBulkCopied] = useState(false);
  // creator profile drawer
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  // outreach "contacted" tracking (localStorage) — handle -> first-contacted ms
  const [contacted, setContacted] = useState<Record<string, number>>({});
  const [hideContacted, setHideContacted] = useState(false);
  // follow-up nudges: handles marked as done/replied, + the queue panel
  const [followupDone, setFollowupDone] = useState<string[]>([]);
  const [showFollowups, setShowFollowups] = useState(false);
  const FOLLOWUP_DAYS = 3;
  const isContacted = (h: string) => h.toLowerCase() in contacted;
  // pinned creators that persist across searches (localStorage)
  const [savedCreators, setSavedCreators] = useState<SavedCreator[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  // side-by-side compare
  const [compareSel, setCompareSel] = useState<Set<string>>(new Set());
  const [compareFor, setCompareFor] = useState<string[] | null>(null);
  const [compareData, setCompareData] = useState<Record<string, ProfileData | null>>({});
  const [compareLoading, setCompareLoading] = useState(false);

  function toggleCompare(handle: string) {
    setCompareSel((s) => {
      const n = new Set(s);
      if (n.has(handle)) n.delete(handle);
      else if (n.size < 4) n.add(handle);
      return n;
    });
  }

  async function openCompare() {
    const handles = [...compareSel];
    if (handles.length < 2) return;
    setCompareFor(handles);
    setShowSaved(false);
    setCompareLoading(true);
    setCompareData({});
    try {
      const entries = await Promise.all(
        handles.map(async (h) => {
          try {
            const d = await fetch(`/api/ig-profile?handle=${encodeURIComponent(h)}`).then((r) => r.json());
            return [h, d.error ? null : (d as ProfileData)] as const;
          } catch {
            return [h, null] as const;
          }
        }),
      );
      setCompareData(Object.fromEntries(entries));
    } finally {
      setCompareLoading(false);
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ii_contacted');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Migrate the old array-of-handles format to { handle: timestamp }.
        if (Array.isArray(parsed)) {
          const now = Date.now();
          setContacted(Object.fromEntries(parsed.map((h: string) => [h, now])));
        } else if (parsed && typeof parsed === 'object') {
          setContacted(parsed);
        }
      }
      const rawSaved = localStorage.getItem('ii_saved_creators');
      if (rawSaved) setSavedCreators(JSON.parse(rawSaved));
      const rawDone = localStorage.getItem('ii_followups_done');
      if (rawDone) setFollowupDone(JSON.parse(rawDone));
    } catch { /* ignore */ }
  }, []);

  function markFollowupDone(handle: string) {
    setFollowupDone((list) => {
      const next = list.includes(handle.toLowerCase()) ? list : [...list, handle.toLowerCase()];
      try { localStorage.setItem('ii_followups_done', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // Contacted > FOLLOWUP_DAYS ago and not yet marked done → a nudge is due.
  const dueFollowups = Object.entries(contacted)
    .filter(([h, ts]) => Date.now() - ts > FOLLOWUP_DAYS * 86_400_000 && !followupDone.includes(h))
    .sort((a, b) => a[1] - b[1])
    .map(([handle, ts]) => ({ handle, ts }));

  function openFollowup(handle: string) {
    setShowFollowups(false);
    void openDraft({ username: handle } as LiveProfile, 'dm', draftLang, true);
  }

  const isSaved = (u: string) => savedCreators.some((s) => s.username.toLowerCase() === u.toLowerCase());

  function toggleSaved(p: LiveProfile) {
    setSavedCreators((list) => {
      const exists = list.some((s) => s.username.toLowerCase() === p.username.toLowerCase());
      const next = exists
        ? list.filter((s) => s.username.toLowerCase() !== p.username.toLowerCase())
        : [{ username: p.username, full_name: p.full_name, followers: p.followers, profile_pic_url: p.profile_pic_url, category: p.category, email: p.email, phone: p.phone }, ...list];
      try { localStorage.setItem('ii_saved_creators', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function clearSaved() {
    setSavedCreators([]);
    try { localStorage.removeItem('ii_saved_creators'); } catch { /* ignore */ }
  }

  function markContacted(handle: string) {
    setContacted((s) => {
      const key = handle.toLowerCase();
      if (key in s) return s; // keep the first-contacted time
      const n = { ...s, [key]: Date.now() };
      try { localStorage.setItem('ii_contacted', JSON.stringify(n)); } catch { /* ignore */ }
      return n;
    });
  }

  async function openProfile(handle: string) {
    if (profileFor === handle) {
      setProfileFor(null); // toggle closed
      return;
    }
    setProfileFor(handle);
    setProfile(null);
    setProfileLoading(true);
    try {
      const d = await fetch(`/api/ig-profile?handle=${encodeURIComponent(handle)}`).then((r) => r.json());
      if (!d.error) setProfile(d as ProfileData);
    } finally {
      setProfileLoading(false);
    }
  }
  // saved searches (localStorage)
  const [saved, setSaved] = useState<{ prompt: string; seed: string }[]>([]);
  const autoRan = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ii_saved_searches');
      if (raw) setSaved(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  function persistSaved(next: { prompt: string; seed: string }[]) {
    setSaved(next);
    try { localStorage.setItem('ii_saved_searches', JSON.stringify(next)); } catch { /* ignore */ }
  }

  function saveCurrentSearch() {
    const entry = { prompt: (run?.prompt ?? prompt).trim(), seed: seedText.trim() };
    if (!entry.prompt) return;
    if (saved.some((s) => s.prompt === entry.prompt && s.seed === entry.seed)) return;
    persistSaved([entry, ...saved].slice(0, 12));
  }

  function runSaved(s: { prompt: string; seed: string }) {
    setPrompt(s.prompt);
    setSeedText(s.seed);
    setSelected(new Set());
    void search({ promptOverride: s.prompt, seedOverride: s.seed });
  }

  function toggleSelect(username: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(username)) n.delete(username);
      else n.add(username);
      return n;
    });
  }

  async function openDraft(p: LiveProfile, channel: 'dm' | 'email' = 'dm', lang: 'auto' | 'english' | 'hinglish' | 'hindi' = draftLang, followup = false) {
    setDraftFor(p);
    setDraftChannel(channel);
    setDraftLang(lang);
    setDraftFollowup(followup);
    setDraftText('');
    setCopied(false);
    setDraftLoading(true);
    try {
      const d = await fetch('/api/discover-live/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: p.username, prompt: run?.prompt, category: p.category, channel, language: lang, followup }),
      }).then((r) => r.json());
      setDraftText(d.message ?? d.error ?? 'Could not generate a message.');
    } catch (err) {
      setDraftText((err as Error).message);
    } finally {
      setDraftLoading(false);
    }
  }

  useEffect(() => {
    fetch('/api/programs')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.programs)) {
          setPrograms(d.programs);
          setProgramId((cur) => cur || d.programs[0]?.id || '');
        }
      })
      .catch(() => {});
  }, []);

  // Resolve the campaign to recruit into — creating one inline if needed.
  async function ensureProgram(): Promise<string | null> {
    let pid = programId;
    if (pid === '__new__' || !pid) {
      const name = window.prompt('New campaign name');
      if (!name?.trim()) return null;
      try {
        const d = await fetch('/api/programs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), source_prompt: run?.prompt }),
        }).then((r) => r.json());
        if (!d.program?.id) return null;
        setPrograms((ps) => [d.program, ...ps]);
        pid = d.program.id;
        setProgramId(pid);
      } catch {
        return null;
      }
    }
    return pid;
  }

  async function recruitOne(pid: string, p: LiveProfile) {
    if (!p.creator_id) return;
    await fetch(`/api/programs/${pid}/recruits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: p.creator_id, source_prompt: run?.prompt, relevance_score: p.score }),
    });
    setRecruited((m) => ({ ...m, [p.creator_id!]: pid }));
  }

  async function addToShortlist(p: LiveProfile) {
    if (!p.creator_id || recruiting) return;
    const pid = await ensureProgram();
    if (!pid) return;
    setRecruiting(p.creator_id);
    try {
      await recruitOne(pid, p);
    } finally {
      setRecruiting(null);
    }
  }

  async function bulkAdd() {
    const targets = shown.filter(
      (p) => selected.has(p.username) && p.creator_id && !recruited[p.creator_id],
    );
    if (targets.length === 0) return;
    const pid = await ensureProgram();
    if (!pid) return;
    setBulkBusy(true);
    try {
      for (const p of targets) {
        try { await recruitOne(pid, p); } catch { /* skip one, keep going */ }
      }
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  }

  async function runBulkDraft(
    targets: { username: string; category?: string; phone?: string | null; email?: string | null }[],
    channel: 'dm' | 'email',
  ) {
    const list = targets.slice(0, 20);
    if (list.length === 0) return;
    setShowSaved(false);
    setBulkChannel(channel);
    setBulkCopied(false);
    setBulkDraft(list.map((p) => ({ username: p.username, message: '', phone: p.phone, email: p.email })));
    setBulkDraftLoading(true);
    try {
      const results = await Promise.all(
        list.map(async (p) => {
          try {
            const d = await fetch('/api/discover-live/outreach', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ handle: p.username, prompt: run?.prompt, category: p.category, channel }),
            }).then((r) => r.json());
            return { username: p.username, message: d.message ?? d.error ?? '', phone: p.phone, email: p.email };
          } catch {
            return { username: p.username, message: '', phone: p.phone, email: p.email };
          }
        }),
      );
      setBulkDraft(results);
    } finally {
      setBulkDraftLoading(false);
    }
  }

  async function openBulkDraft(channel: 'dm' | 'email' = 'dm') {
    await runBulkDraft(shown.filter((p) => selected.has(p.username)), channel);
  }

  const suggestions = buildSuggestions(prompt);
  const sugOpen = showSug && suggestions.length > 0;

  const shown = (() => {
    if (!run) return [] as LiveProfile[];
    const filtered = run.results.filter(
      (p) =>
        p.followers >= minFollowers &&
        (!verifiedOnly || p.is_verified) &&
        (!healthyOnly || authenticityFlag(p.followers, p.engagement) !== 'low') &&
        (!hideContacted || !isContacted(p.username)),
    );
    const sorted = [...filtered];
    if (sortBy === 'followers_desc') sorted.sort((a, b) => b.followers - a.followers);
    else if (sortBy === 'followers_asc') sorted.sort((a, b) => a.followers - b.followers);
    else if (sortBy === 'engagement') sorted.sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0));
    // 'relevance' keeps the server order (score, then followers)
    return sorted;
  })();

  function pickSuggestion(s: string) {
    setPrompt(s);
    setShowSug(false);
    setActiveIdx(-1);
  }

  // One search: a username crawls Instagram live; otherwise search the database.
  function runSearch() {
    setShowSug(false); // close the autocomplete dropdown on every search
    setActiveIdx(-1);
    const u = seedText.trim();
    if (u.length >= 2) void search({ seedOverride: seedText, mode: 'live' });
    else void search({ seedOverride: '', mode: 'db' });
  }

  // "More like this" — re-seed the search from one creator's network.
  function findSimilar(p: LiveProfile) {
    setSeedText(p.username);
    setSelected(new Set());
    void search({ promptOverride: prompt.trim(), seedOverride: p.username, mode: 'live' });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Arriving from the home page with a prompt → run once (seed optional; the
  // server self-seeds from the prompt when no handle/name is given).
  useEffect(() => {
    if (autoRan.current) return;
    if (initialPrompt.trim().length >= 2 || initialSeed.trim().length >= 2) {
      autoRan.current = true;
      void search({ mode: initialMode, seedOverride: initialMode === 'db' ? '' : undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(opts?: { promptOverride?: string; seedOverride?: string; mode?: 'db' | 'live' }) {
    const typedPrompt = (opts?.promptOverride ?? prompt).trim();
    const { seeds, names } = parseSeedInput(opts?.seedOverride ?? seedText);
    const mode = opts?.mode ?? 'live';
    // The server needs a prompt for ranking; for a bare username crawl, fall back
    // to the handle/name so we never invent a keyword the user didn't type.
    const p = typedPrompt.length >= 2 ? typedPrompt : (seeds[0] ?? names[0] ?? '');
    if (p.length < 2) return;

    setLoading(true);
    setError(null);
    setNeedSeed(false);
    try {
      const r = await fetch('/api/discover-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p, seeds, names, mode }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.error === 'no_seeds') setNeedSeed(true);
        else setError(d.message ?? d.error ?? 'Search failed');
        setRun(null);
      } else {
        setRun(d as RunResponse);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function downloadExcel(rows?: LiveProfile[]) {
    if (!run) return;
    const results = rows && rows.length > 0 ? rows : shown;
    setExporting(true);
    try {
      const r = await fetch('/api/discover-live/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: run.prompt, results }),
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${run.prompt.replace(/[^a-z0-9]+/gi, '_').slice(0, 40) || 'search'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function exportSaved() {
    if (savedCreators.length === 0) return;
    setExporting(true);
    try {
      const r = await fetch('/api/discover-live/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'saved_creators', results: savedCreators }),
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'saved_creators.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="w-full">
      {/* search box */}
      <div className="rounded-2xl bg-white border-2 border-[#e3def9] p-4 shadow-[0_12px_50px_rgba(108,77,246,0.12)] focus-within:border-[#6C4DF6] transition-colors">
        {/* prompt + database-search magnifier (above the line) */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setShowSug(true);
                setActiveIdx(-1);
              }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 120)}
              onKeyDown={(e) => {
                if (sugOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault();
                  setActiveIdx((i) => {
                    const n = suggestions.length;
                    return e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
                  });
                  return;
                }
                if (e.key === 'Escape') {
                  setShowSug(false);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (sugOpen && activeIdx >= 0) pickSuggestion(suggestions[activeIdx]!);
                  else runSearch();
                }
              }}
              rows={1}
              placeholder="Describe who you're looking for — e.g. nagpur fashion creators"
              className="w-full resize-none text-[16px] text-[#222] placeholder-[#9aa] focus:outline-none bg-transparent"
            />
            {sugOpen && (
              <div className="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl bg-white border border-[#ececec] shadow-[0_16px_50px_rgba(0,0,0,0.12)] overflow-hidden">
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => pickSuggestion(s)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[15px] transition-colors ${
                      i === activeIdx ? 'bg-[#f6f4ff]' : 'hover:bg-[#faf9ff]'
                    }`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                    <span className="text-[#333]">{s}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* one search: username → Instagram crawl, else database */}
        <div className="mt-3 flex items-center gap-2 border-t border-[#f0eefc] pt-3">
          <span className="text-[#9b7bff] shrink-0" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" /></svg>
          </span>
          <input
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="Optional — add a @username to crawl Instagram, or leave blank to search your database"
            className="flex-1 min-w-0 text-[14px] text-[#222] placeholder-[#aaa] focus:outline-none bg-transparent"
          />
          <button
            onClick={runSearch}
            disabled={loading || prompt.trim().length < 2}
            aria-label="Search"
            title="Search"
            className="w-12 h-12 rounded-full grid place-items-center text-white shadow-md shrink-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:brightness-105 disabled:opacity-50 disabled:translate-y-0 disabled:shadow-md"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
          >
            {loading ? (
              <span className="w-5 h-5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            )}
          </button>
        </div>
      </div>

      {/* saved searches */}
      {saved.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[#999]">Saved:</span>
          {saved.map((s, i) => (
            <span key={`${s.prompt}|${s.seed}`} className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full border border-[#e3def9] bg-white text-[12px]">
              <button onClick={() => runSaved(s)} className="hover:underline" style={{ color: ACCENT }} title={s.seed ? `seed: ${s.seed}` : undefined}>
                {s.prompt}
              </button>
              <button
                onClick={() => persistSaved(saved.filter((_, j) => j !== i))}
                className="w-4 h-4 grid place-items-center rounded-full text-[#bbb] hover:text-[#666] hover:bg-[#f3f3f3]"
                title="Remove"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* no-seed nudge (only when auto-seeding also found nothing) */}
      {needSeed && (
        <div className="mt-3 px-4 py-3 rounded-lg border border-[#e3def9] bg-[#faf9ff] text-[14px] text-[#444]">
          Couldn’t auto-find a starting point for that prompt.{' '}
          <span className="font-medium text-[#222]">Do you know anyone in this space?</span> Add a
          name (e.g. <span className="font-mono">mridul sharma</span>) or an @handle above and we’ll
          start from there.
        </div>
      )}

      {/* starting points: typed-name matches and/or auto-found seeds */}
      {run && !loading && (() => {
        const fromNames = (run.resolved_from_names ?? []).map((m) => ({
          handle: m.handle,
          followers: m.followers,
        }));
        const starts = [...fromNames, ...(run.auto_seeds ?? [])];
        if (starts.length === 0) return null;
        const label = fromNames.length > 0 ? 'Matched to' : 'Auto-found starting points';
        return (
          <div className="mt-3 px-4 py-2.5 rounded-lg border border-[#e3def9] bg-[#faf9ff] text-[13px] text-[#555]">
            {label}:{' '}
            {starts.map((m, i) => (
              <span key={m.handle}>
                {i > 0 && ', '}
                <a
                  href={`https://instagram.com/${m.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                  style={{ color: ACCENT }}
                >
                  @{m.handle}
                </a>{' '}
                <span className="text-[#999]">({fmt(m.followers)})</span>
              </span>
            ))}
          </div>
        );
      })()}

      {error && (
        <div className="mt-3 px-4 py-3 rounded-lg border border-rose-300 bg-rose-50 text-[14px] text-rose-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-10 flex flex-col items-center justify-center">
          <div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
          <div className="mt-3 text-[13px] text-[#888]">Finding starting points & crawling Instagram…</div>
        </div>
      )}

      {/* results table */}
      {run && !loading && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[14px] text-[#555]">
              <span className="font-semibold text-[#111]">{shown.length}</span>
              {shown.length !== run.results.length && <span className="text-[#999]">/{run.results.length}</span>} profiles for{' '}
              <span className="font-medium text-[#111]">“{run.prompt}”</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={saveCurrentSearch}
                className="px-3 py-2 rounded-lg text-[13px] font-medium border border-[#e3def9] hover:bg-[#faf9ff]"
                style={{ color: ACCENT }}
                title="Save this search"
              >
                ★ Save
              </button>
              <button
                onClick={() => void downloadExcel()}
                disabled={exporting || shown.length === 0}
                className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-[#e3def9] hover:bg-[#faf9ff] disabled:opacity-50"
                style={{ color: ACCENT }}
              >
                {exporting ? 'Preparing…' : '⬇ Download Excel'}
              </button>
            </div>
          </div>

          {/* filters + sort */}
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <select
              value={minFollowers}
              onChange={(e) => setMinFollowers(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white focus:outline-none focus:border-[#6C4DF6]"
            >
              <option value={0}>Any followers</option>
              <option value={1000}>1K+</option>
              <option value={10000}>10K+</option>
              <option value={100000}>100K+</option>
              <option value={1000000}>1M+</option>
            </select>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white cursor-pointer select-none">
              <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="accent-[#6C4DF6]" />
              Verified only
            </label>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white cursor-pointer select-none" title="Hide profiles whose engagement is suspiciously low for their size">
              <input type="checkbox" checked={healthyOnly} onChange={(e) => setHealthyOnly(e.target.checked)} className="accent-[#6C4DF6]" />
              Healthy eng. only
            </label>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white cursor-pointer select-none" title="Hide creators you've already reached out to">
              <input type="checkbox" checked={hideContacted} onChange={(e) => setHideContacted(e.target.checked)} className="accent-[#6C4DF6]" />
              Hide contacted
            </label>
            <span className="ml-auto text-[#999]">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white focus:outline-none focus:border-[#6C4DF6]"
            >
              <option value="relevance">Relevance</option>
              <option value="followers_desc">Followers: high → low</option>
              <option value="followers_asc">Followers: low → high</option>
              <option value="engagement">Engagement</option>
            </select>
            <span className="text-[#999]">·</span>
            <span className="text-[#999]">Add to</span>
            <select
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white focus:outline-none focus:border-[#6C4DF6] max-w-[160px]"
            >
              {programs.length === 0 && <option value="">No campaigns yet</option>}
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="__new__">＋ New campaign…</option>
            </select>
          </div>

          {/* bulk action bar */}
          {selected.size > 0 && (
            <div className="mb-3 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#f6f4ff] border border-[#e3def9] text-[13px]">
              <span className="font-medium text-[#111]">{selected.size} selected</span>
              <button
                onClick={() => void bulkAdd()}
                disabled={bulkBusy}
                className="px-3 py-1.5 rounded-lg text-white font-semibold disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                {bulkBusy ? 'Adding…' : `Add ${selected.size} to campaign`}
              </button>
              <button
                onClick={() => void openBulkDraft('dm')}
                className="px-3 py-1.5 rounded-lg font-semibold border border-[#e3def9] hover:bg-white"
                style={{ color: ACCENT }}
              >
                ✦ Draft outreach
              </button>
              <button
                onClick={() => void downloadExcel(shown.filter((p) => selected.has(p.username)))}
                disabled={exporting}
                className="px-3 py-1.5 rounded-lg font-semibold border border-[#e3def9] hover:bg-white disabled:opacity-50"
                style={{ color: ACCENT }}
              >
                {exporting ? 'Preparing…' : '⬇ Export selected'}
              </button>
              <button onClick={() => setSelected(new Set())} className="text-[#666] hover:text-[#111]">Clear</button>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="px-4 py-10 text-center text-[14px] text-[#888] border border-[#eee] rounded-xl">
              {run.results.length === 0
                ? 'No profiles found from that seed. Try a different starting @handle.'
                : 'No profiles match these filters. Loosen them to see more.'}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#eee]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#faf9ff] text-[12px] uppercase tracking-wider text-[#888]">
                    <th className="px-3 py-2.5 w-8">
                      <input
                        type="checkbox"
                        className="accent-[#6C4DF6]"
                        checked={shown.length > 0 && shown.every((p) => selected.has(p.username))}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(shown.map((p) => p.username)) : new Set())
                        }
                      />
                    </th>
                    <th className="px-3 py-2.5 font-medium w-10">#</th>
                    <th className="px-3 py-2.5 font-medium">Creator</th>
                    <th className="px-3 py-2.5 font-medium">Category</th>
                    <th className="px-3 py-2.5 font-medium text-right">Followers</th>
                    <th className="px-3 py-2.5 font-medium text-right">Eng.</th>
                    <th className="px-3 py-2.5 font-medium text-center">Relevance</th>
                    <th className="px-3 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3f3f3]">
                  {shown.map((p, i) => (
                    <Fragment key={p.username}>
                    <tr className={`hover:bg-[#fafaff] ${selected.has(p.username) || profileFor === p.username ? 'bg-[#faf9ff]' : ''}`}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          className="accent-[#6C4DF6]"
                          checked={selected.has(p.username)}
                          onChange={() => toggleSelect(p.username)}
                        />
                      </td>
                      <td className="px-3 py-3 text-[13px] text-[#aaa] tabular-nums">{i + 1}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <button onClick={() => void openProfile(p.username)} className="shrink-0" title="View profile">
                            <Avatar name={p.full_name || p.username} url={p.profile_pic_url} />
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => void openProfile(p.username)}
                                className="text-[14px] font-medium text-[#111] truncate hover:underline"
                                style={{ textDecorationColor: ACCENT }}
                                title="View profile"
                              >
                                @{p.username}
                              </button>
                              {p.is_verified && (
                                <span title="verified" style={{ color: ACCENT }}>✔</span>
                              )}
                              {p.from === 'db' && (
                                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#eef] text-[#6C4DF6]" title="from your database">
                                  DB
                                </span>
                              )}
                              {isRisingStar(p.followers, p.engagement ?? null) && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200" title="High engagement for their size — likely on the rise">
                                  ⭐ Rising
                                </span>
                              )}
                              {isContacted(p.username) && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600" title="You've reached out">
                                  Contacted ✓
                                </span>
                              )}
                            </div>
                            <div className="text-[12px] text-[#999] truncate max-w-[260px]">
                              {p.full_name || '—'}
                            </div>
                            {(p.email || p.phone || p.link) && (
                              <div className="mt-1 flex items-center gap-2 text-[11px]">
                                {p.email && (
                                  <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 text-[#10b981] hover:underline truncate max-w-[150px]" title={p.email}>✉ {p.email}</a>
                                )}
                                {p.phone && (
                                  <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-[#0ea5e9] hover:underline" title={p.phone}>📞 {p.phone}</a>
                                )}
                                {p.link && (
                                  <a href={p.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#888] hover:underline" title={p.link}>🔗 link</a>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-[#666]">{p.category || '—'}</td>
                      <td className="px-3 py-3 text-[14px] text-[#111] text-right tabular-nums">
                        {fmt(p.followers)}
                      </td>
                      <td className="px-3 py-3 text-[13px] text-right tabular-nums whitespace-nowrap">
                        {(() => {
                          const flag = authenticityFlag(p.followers, p.engagement);
                          return (
                            <span className="inline-flex items-center gap-1 justify-end" style={{ color: flag === 'low' ? '#f59e0b' : (p.engagement ?? 0) > 0 ? '#10b981' : '#bbb' }}>
                              {flag === 'low' && <span title="Low engagement for follower count — possible fake followers">⚠</span>}
                              {(p.engagement ?? 0) > 0 ? `${p.engagement}%` : '—'}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className="inline-block text-[12px] font-semibold px-2 py-0.5 rounded-md tabular-nums"
                          style={{ background: ACCENT_SOFT, color: ACCENT }}
                        >
                          {p.score}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => toggleSaved(p)}
                            title={isSaved(p.username) ? 'Saved — click to remove' : 'Save creator'}
                            className="w-8 h-8 grid place-items-center rounded-lg border transition-colors"
                            style={{ color: ACCENT, borderColor: isSaved(p.username) ? ACCENT : '#e3def9', background: isSaved(p.username) ? '#f4f0ff' : undefined }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill={isSaved(p.username) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></svg>
                          </button>
                          <IconBtn onClick={() => findSimilar(p)} title="Find similar creators">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17.5" cy="9.5" r="2" /><path d="M16 19a4 4 0 0 1 6-3" /></svg>
                          </IconBtn>
                          <IconBtn onClick={() => void openDraft(p)} title="AI outreach draft">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z" /></svg>
                          </IconBtn>
                          {p.creator_id && (recruited[p.creator_id] ? (
                            <span className="w-8 h-8 grid place-items-center rounded-lg text-emerald-600" title="Added to campaign">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10" /></svg>
                            </span>
                          ) : (
                            <IconBtn onClick={() => void addToShortlist(p)} disabled={recruiting === p.creator_id} title="Add to campaign">
                              {recruiting === p.creator_id ? (
                                <span className="w-3.5 h-3.5 rounded-full border-2 border-[#ddd] border-t-[#6C4DF6] animate-spin" />
                              ) : (
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                              )}
                            </IconBtn>
                          ))}
                          <a
                            href={`https://instagram.com/${p.username}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Open on Instagram"
                            className="w-8 h-8 grid place-items-center rounded-lg border border-[#e3def9] hover:bg-[#faf9ff]"
                            style={{ color: ACCENT }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M9 7h8v8" /></svg>
                          </a>
                        </div>
                      </td>
                    </tr>
                    {profileFor === p.username && (
                      <tr>
                        <td colSpan={8} className="px-4 pb-4 pt-0 bg-[#faf9ff]">
                          <ProfileSnapshot loading={profileLoading} profile={profile} onDraft={() => void openDraft(p)} onClose={() => setProfileFor(null)} onPivot={(h) => { setProfileFor(null); void search({ promptOverride: h, seedOverride: h, mode: 'live' }); }} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* AI outreach draft modal */}
      {draftFor && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setDraftFor(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-[#e3def9] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 flex items-center justify-between text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
              <div className="text-[15px] font-semibold">{draftFollowup ? 'Follow-up to' : 'Outreach to'} @{draftFor.username}</div>
              <button onClick={() => setDraftFor(null)} className="text-white/80 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#f4f0ff] text-[13px]">
                  {(['dm', 'email'] as const).map((ch) => (
                    <button
                      key={ch}
                      onClick={() => void openDraft(draftFor, ch, draftLang, draftFollowup)}
                      className={`px-3 py-1 rounded-md transition-colors ${draftChannel === ch ? 'bg-white shadow-sm font-medium' : 'text-[#888]'}`}
                      style={draftChannel === ch ? { color: ACCENT } : undefined}
                    >
                      {ch === 'dm' ? 'Instagram DM' : 'Email'}
                    </button>
                  ))}
                </div>
                <select
                  value={draftLang}
                  onChange={(e) => void openDraft(draftFor, draftChannel, e.target.value as 'auto' | 'english' | 'hinglish' | 'hindi', draftFollowup)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] text-[13px] text-[#444] focus:outline-none focus:border-[#6C4DF6]"
                  title="Language"
                >
                  <option value="auto">🌐 Auto-detect</option>
                  <option value="english">English</option>
                  <option value="hinglish">Hinglish</option>
                  <option value="hindi">हिंदी</option>
                </select>
              </div>
              <textarea
                value={draftLoading ? 'Drafting…' : draftText}
                onChange={(e) => setDraftText(e.target.value)}
                readOnly={draftLoading}
                rows={7}
                className="w-full text-[14px] text-[#222] rounded-xl border border-[#e3def9] p-3 focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all resize-none"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  onClick={() => { void navigator.clipboard.writeText(draftText); setCopied(true); }}
                  disabled={draftLoading || !draftText}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold border border-[#e3def9] disabled:opacity-50"
                  style={{ color: ACCENT }}
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
                {draftFor.email && (
                  <a
                    href={mailLink(draftFor.email, draftText)}
                    onClick={() => markContacted(draftFor.username)}
                    className={`px-4 py-2 rounded-lg text-white text-[13px] font-semibold ${draftLoading || !draftText ? 'pointer-events-none opacity-50' : ''}`}
                    style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
                  >
                    ✉ Send email
                  </a>
                )}
                {draftFor.phone && (
                  <a
                    href={waLink(draftFor.phone, draftText)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => markContacted(draftFor.username)}
                    className={`px-4 py-2 rounded-lg text-white text-[13px] font-semibold ${draftLoading || !draftText ? 'pointer-events-none opacity-50' : ''}`}
                    style={{ background: '#25D366' }}
                  >
                    Send on WhatsApp
                  </a>
                )}
                {!draftFor.email && !draftFor.phone && (
                  <a
                    href={`https://instagram.com/${draftFor.username}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => { void navigator.clipboard.writeText(draftText); setCopied(true); markContacted(draftFor.username); }}
                    className={`px-4 py-2 rounded-lg text-white text-[13px] font-semibold ${draftLoading || !draftText ? 'pointer-events-none opacity-50' : ''}`}
                    style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
                  >
                    Copy &amp; open Instagram →
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* bulk outreach drafts modal */}
      {bulkDraft && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" onClick={() => setBulkDraft(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-[#eee]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 pb-3 border-b border-[#f0f0f0]">
              <div className="text-[15px] font-semibold text-[#111]">
                Outreach drafts · {bulkDraft.length} creators
                {bulkDraftLoading && <span className="ml-2 text-[12px] font-normal text-[#999]">generating…</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#f4f4f6] text-[12px]">
                  {(['dm', 'email'] as const).map((ch) => (
                    <button
                      key={ch}
                      onClick={() => void openBulkDraft(ch)}
                      className={`px-2.5 py-1 rounded-md transition-colors ${bulkChannel === ch ? 'bg-white shadow-sm font-medium text-[#111]' : 'text-[#888]'}`}
                    >
                      {ch === 'dm' ? 'DM' : 'Email'}
                    </button>
                  ))}
                </div>
                <button onClick={() => setBulkDraft(null)} className="text-[#999] hover:text-[#111] text-lg leading-none">×</button>
              </div>
            </div>
            <div className="overflow-y-auto p-5 space-y-3 flex-1">
              {bulkDraft.map((item, i) => (
                <div key={item.username} className="rounded-xl border border-[#eee] p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-medium text-[#111]">@{item.username}</span>
                    <div className="flex items-center gap-2.5 text-[12px] font-medium">
                      {item.email && (
                        <a href={mailLink(item.email, item.message)} onClick={() => markContacted(item.username)} className={`${!item.message ? 'pointer-events-none opacity-40' : ''}`} style={{ color: ACCENT }}>✉ Email</a>
                      )}
                      {item.phone && (
                        <a href={waLink(item.phone, item.message)} target="_blank" rel="noreferrer" onClick={() => markContacted(item.username)} className={`${!item.message ? 'pointer-events-none opacity-40' : ''}`} style={{ color: '#1ebe57' }}>WhatsApp</a>
                      )}
                      <button
                        onClick={() => { void navigator.clipboard.writeText(item.message); }}
                        disabled={!item.message}
                        className="disabled:opacity-40"
                        style={{ color: ACCENT }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={item.message || (bulkDraftLoading ? 'Drafting…' : '')}
                    onChange={(e) => setBulkDraft((cur) => cur?.map((x, j) => (j === i ? { ...x, message: e.target.value } : x)) ?? cur)}
                    readOnly={bulkDraftLoading}
                    rows={3}
                    className="w-full text-[13px] text-[#222] rounded-lg border border-[#e3def9] p-2.5 focus:outline-none focus:border-[#6C4DF6] resize-none"
                  />
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-[#f0f0f0] flex items-center justify-end">
              <button
                onClick={() => {
                  const all = bulkDraft.map((x) => `@${x.username}\n${x.message}`).join('\n\n———\n\n');
                  void navigator.clipboard.writeText(all);
                  setBulkCopied(true);
                }}
                disabled={bulkDraftLoading}
                className="px-4 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                {bulkCopied ? 'Copied all ✓' : 'Copy all'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating actions: follow-up nudges + saved creators */}
      {!showSaved && !showFollowups && (savedCreators.length > 0 || dueFollowups.length > 0) && (
        <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2.5">
          {dueFollowups.length > 0 && (
            <button
              onClick={() => setShowFollowups(true)}
              className="flex items-center gap-2 pl-4 pr-5 py-3 rounded-full text-white text-[14px] font-semibold shadow-[0_12px_40px_rgba(245,158,11,0.45)] hover:-translate-y-0.5 transition-transform"
              style={{ background: 'linear-gradient(135deg, #F59E0B, #F7B500)', animation: 'ii-fadeup .3s both' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              {dueFollowups.length} follow-up{dueFollowups.length > 1 ? 's' : ''} due
            </button>
          )}
          {savedCreators.length > 0 && (
            <button
              onClick={() => setShowSaved(true)}
              className="flex items-center gap-2 pl-4 pr-5 py-3 rounded-full text-white text-[14px] font-semibold shadow-[0_12px_40px_rgba(108,77,246,0.4)] hover:-translate-y-0.5 transition-transform"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)`, animation: 'ii-fadeup .3s both' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></svg>
              {savedCreators.length} saved
            </button>
          )}
        </div>
      )}

      {showFollowups && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setShowFollowups(false)}>
          <div className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col" style={{ animation: 'ii-slidein .25s both' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center justify-between text-white" style={{ background: 'linear-gradient(135deg, #F59E0B, #F7B500)' }}>
              <div className="text-[15px] font-semibold">Follow-ups due · {dueFollowups.length}</div>
              <button onClick={() => setShowFollowups(false)} className="text-white/80 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-2.5 text-[12px] text-[#888] border-b border-[#f0f0f0]">Contacted {FOLLOWUP_DAYS}+ days ago with no reply marked. Send a gentle nudge.</div>
            <div className="flex-1 overflow-y-auto divide-y divide-[#f3f3f3]">
              {dueFollowups.length === 0 ? (
                <div className="px-5 py-10 text-center text-[14px] text-[#999]">You're all caught up 🎉</div>
              ) : (
                dueFollowups.map(({ handle, ts }) => {
                  const days = Math.floor((Date.now() - ts) / 86_400_000);
                  return (
                    <div key={handle} className="flex items-center gap-3 px-5 py-3">
                      <Avatar name={handle} url={null} />
                      <div className="min-w-0 flex-1">
                        <a href={`https://instagram.com/${handle}`} target="_blank" rel="noreferrer" className="text-[14px] font-semibold text-[#111] truncate hover:underline">@{handle}</a>
                        <div className="text-[12px] text-[#999]">contacted {days} day{days !== 1 ? 's' : ''} ago</div>
                      </div>
                      <button onClick={() => openFollowup(handle)} className="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold hover:brightness-105 shrink-0" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>✦ Follow up</button>
                      <button onClick={() => markFollowupDone(handle)} className="text-[#bbb] hover:text-emerald-500 shrink-0" title="Mark replied / done">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10" /></svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {showSaved && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setShowSaved(false)}>
          <div className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col" style={{ animation: 'ii-slidein .25s both' }} onClick={(e) => e.stopPropagation()}>
            <style>{`@keyframes ii-slidein{from{transform:translateX(100%)}to{transform:none}}`}</style>
            <div className="px-5 py-4 flex items-center justify-between text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
              <div className="text-[15px] font-semibold">Saved creators · {savedCreators.length}</div>
              <button onClick={() => setShowSaved(false)} className="text-white/80 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-[#f3f3f3]">
              {savedCreators.map((s) => (
                <div key={s.username} className="flex items-center gap-3 px-5 py-3">
                  <input
                    type="checkbox"
                    className="accent-[#6C4DF6] shrink-0"
                    checked={compareSel.has(s.username)}
                    disabled={!compareSel.has(s.username) && compareSel.size >= 4}
                    onChange={() => toggleCompare(s.username)}
                    title="Select to compare (up to 4)"
                  />
                  <Avatar name={s.full_name || s.username} url={s.profile_pic_url} />
                  <div className="min-w-0 flex-1">
                    <a href={`https://instagram.com/${s.username}`} target="_blank" rel="noreferrer" className="text-[14px] font-semibold text-[#111] truncate hover:underline">@{s.username}</a>
                    <div className="text-[12px] text-[#999] truncate">{fmt(s.followers)} followers{s.category ? ` · ${s.category}` : ''}</div>
                  </div>
                  <button onClick={() => toggleSaved({ username: s.username } as LiveProfile)} className="text-[#bbb] hover:text-rose-500 text-lg leading-none" title="Remove">×</button>
                </div>
              ))}
            </div>
            {compareSel.size > 0 && (
              <button
                onClick={() => void openCompare()}
                disabled={compareSel.size < 2}
                className="mx-5 mt-3 px-4 py-2.5 rounded-xl text-[13px] font-semibold border-2 disabled:opacity-50"
                style={{ color: ACCENT, borderColor: ACCENT }}
              >
                ⚖ Compare {compareSel.size} {compareSel.size < 2 ? '(pick 2+)' : 'side by side'}
              </button>
            )}
            <div className="px-5 py-4 border-t border-[#eee] flex items-center gap-2">
              <button
                onClick={() => void runBulkDraft(savedCreators, 'dm')}
                className="flex-1 px-4 py-2.5 rounded-xl text-white text-[14px] font-semibold hover:brightness-105"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
              >
                ✦ Draft outreach to all
              </button>
              <button onClick={() => void exportSaved()} disabled={exporting} className="px-4 py-2.5 rounded-xl text-[13px] font-medium border border-[#e3def9] hover:bg-[#faf9ff] disabled:opacity-50" style={{ color: ACCENT }} title="Export to Excel">{exporting ? '…' : '⬇'}</button>
              <button onClick={clearSaved} className="px-4 py-2.5 rounded-xl text-[13px] font-medium border border-[#eee] text-[#666] hover:bg-[#faf9ff]">Clear</button>
            </div>
          </div>
        </div>
      )}

      {compareFor && (
        <CompareModal
          handles={compareFor}
          data={compareData}
          loading={compareLoading}
          onClose={() => setCompareFor(null)}
          onDraft={(h) => { setCompareFor(null); void openDraft({ username: h } as LiveProfile); }}
        />
      )}

    </div>
  );
}

function CompareModal({
  handles,
  data,
  loading,
  onClose,
  onDraft,
}: {
  handles: string[];
  data: Record<string, ProfileData | null>;
  loading: boolean;
  onClose: () => void;
  onDraft: (handle: string) => void;
}) {
  const erOf = (p: ProfileData) =>
    p.followers > 0 && p.recent.length > 0
      ? Math.round((p.recent.reduce((s, x) => s + x.likes + x.comments, 0) / p.recent.length / p.followers) * 1000) / 10
      : null;

  const cols = handles.map((h) => {
    const p = data[h] ?? null;
    const er = p ? erOf(p) : null;
    const rate = p ? estimatedRate(p.followers, er) : null;
    const rhythm = p ? postingInsight(p.recent) : null;
    const themes = p ? contentThemes(p.recent, 4) : [];
    return { h, p, er, rate, rhythm, themes };
  });

  // Best-in-row highlights.
  const maxFollowers = Math.max(...cols.map((c) => c.p?.followers ?? 0));
  const maxEr = Math.max(...cols.map((c) => c.er ?? 0));

  const Row = ({ label, render }: { label: string; render: (c: (typeof cols)[number]) => React.ReactNode }) => (
    <tr className="border-t border-[#f3f3f3]">
      <td className="py-2.5 pr-3 text-[12px] text-[#999] align-top whitespace-nowrap">{label}</td>
      {cols.map((c) => (
        <td key={c.h} className="py-2.5 px-3 text-[13px] text-[#222] align-top">{render(c)}</td>
      ))}
    </tr>
  );

  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-black/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[85vh] overflow-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 px-5 py-4 flex items-center justify-between text-white z-10" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
          <div className="text-[15px] font-semibold">⚖ Compare creators · {cols.length}</div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">×</button>
        </div>
        {loading ? (
          <div className="p-12 grid place-items-center"><div className="w-7 h-7 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : (
          <div className="p-5 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th />
                  {cols.map((c) => (
                    <th key={c.h} className="px-3 pb-2 text-left">
                      <div className="flex items-center gap-2">
                        <Avatar name={c.p?.full_name || c.h} url={c.p?.profile_pic_url ?? null} />
                        <a href={`https://instagram.com/${c.h}`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-[#111] hover:underline truncate">@{c.h}</a>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="Followers" render={(c) => <span className={c.p && c.p.followers === maxFollowers && maxFollowers > 0 ? 'font-bold' : ''} style={c.p && c.p.followers === maxFollowers ? { color: ACCENT } : undefined}>{c.p ? fmt(c.p.followers) : '—'}</span>} />
                <Row label="Engagement" render={(c) => c.er != null ? <span className={c.er === maxEr && maxEr > 0 ? 'font-bold' : ''} style={c.er === maxEr ? { color: '#059669' } : undefined}>{c.er}%</span> : '—'} />
                <Row label="Est. rate / post" render={(c) => c.rate ? `${inr(c.rate.low)}–${inr(c.rate.high)}` : '—'} />
                <Row label="Posts" render={(c) => c.p ? fmt(c.p.posts) : '—'} />
                <Row label="Cadence" render={(c) => c.rhythm?.cadence ?? '—'} />
                <Row label="Best time" render={(c) => c.rhythm ? `${c.rhythm.bestDay}, ${c.rhythm.bestWindow}` : '—'} />
                <Row label="Themes" render={(c) => c.themes.length ? <span className="text-[12px]">{c.themes.join(' ')}</span> : '—'} />
                <Row label="Contact" render={(c) => c.p?.email ? <span className="text-[12px] text-[#10b981] break-all">{c.p.email}</span> : c.p?.phone ? <span className="text-[12px] text-[#0ea5e9]">{c.p.phone}</span> : '—'} />
                <Row label="" render={(c) => (
                  <button onClick={() => onDraft(c.h)} className="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold hover:brightness-105" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>✦ Draft</button>
                )} />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileSnapshot({ loading, profile, onDraft, onClose, onPivot }: { loading: boolean; profile: ProfileData | null; onDraft: () => void; onClose: () => void; onPivot: (handle: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [rivals, setRivals] = useState('');
  const [growth, setGrowth] = useState<{ pct: number; days: number } | null>(null);
  useEffect(() => {
    if (!profile) return;
    const prior = readGrowth(profile.handle);
    const first = prior[0];
    if (first && first.f > 0 && first.f !== profile.followers) {
      const pct = Math.round(((profile.followers - first.f) / first.f) * 1000) / 10;
      const days = Math.max(1, Math.round((Date.now() - first.t) / 86_400_000));
      setGrowth({ pct, days });
    } else {
      setGrowth(null);
    }
    recordGrowth(profile.handle, profile.followers);
  }, [profile?.handle, profile?.followers]);
  if (loading || !profile) {
    return (
      <div className="relative rounded-xl border border-[#e3def9] bg-white p-6 grid place-items-center" style={{ animation: 'ii-fadeup .3s both' }}>
        <button onClick={onClose} className="absolute top-2.5 right-3 text-[#bbb] hover:text-[#666] text-lg leading-none" title="Close">×</button>
        <div className="w-7 h-7 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
      </div>
    );
  }
  const engagement = profile.followers > 0 && profile.recent.length > 0
    ? Math.round(
        (profile.recent.reduce((s, p) => s + p.likes + p.comments, 0) / profile.recent.length / profile.followers) * 1000,
      ) / 10
    : null;

  const floor = expectedErFloor(profile.followers);
  const healthy = engagement != null && engagement >= floor;
  const rhythm = postingInsight(profile.recent);
  const themes = contentThemes(profile.recent);
  const rate = estimatedRate(profile.followers, engagement);
  const rising = isRisingStar(profile.followers, engagement);
  const collabs = profile.collabs ?? [];
  const rivalTerms = rivals.toLowerCase().split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  const isRival = (h: string) => rivalTerms.some((t) => h.toLowerCase().includes(t));
  const conflictCount = collabs.filter((c) => isRival(c.handle)).length;

  const copySummary = () => {
    const lines = [
      `@${profile.handle}${profile.is_verified ? ' ✔' : ''}${profile.full_name ? ` — ${profile.full_name}` : ''}`,
      `${fmt(profile.followers)} followers · ${fmt(profile.posts)} posts${engagement != null ? ` · ${engagement}% engagement (${healthy ? 'healthy' : 'low'})` : ''}`,
      rate ? `Est. rate/post: ${inr(rate.low)}–${inr(rate.high)}` : '',
      rhythm ? `Posting: ${rhythm.cadence} · best ${rhythm.bestDay}, ${rhythm.bestWindow}` : '',
      themes.length ? `Themes: ${themes.join(' ')}` : '',
      profile.email ? `Email: ${profile.email}` : '',
      profile.phone ? `Phone: ${profile.phone}` : '',
      `https://instagram.com/${profile.handle}`,
    ].filter(Boolean);
    void navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="relative rounded-2xl border border-[#e3def9] bg-white p-5 grid lg:grid-cols-[1fr_1.05fr] gap-6 transition-shadow hover:shadow-[0_12px_44px_rgba(108,77,246,0.1)]" style={{ animation: 'ii-fadeup .3s both' }}>
      <button onClick={onClose} className="absolute top-3 right-3.5 z-10 w-7 h-7 grid place-items-center rounded-full text-[#999] hover:text-[#111] hover:bg-[#f3f3f3] text-lg leading-none" title="Close">×</button>
      {/* left: details, vertically balanced */}
      <div className="flex flex-col">
        <div className="flex items-center gap-3">
          <Avatar name={profile.full_name || profile.handle} url={profile.profile_pic_url} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <a href={`https://instagram.com/${profile.handle}`} target="_blank" rel="noreferrer" className="text-[15px] font-semibold text-[#111] truncate hover:underline">@{profile.handle}</a>
              {profile.is_verified && <span style={{ color: ACCENT }}>✔</span>}
              {rising && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-600 border border-amber-200" title="High engagement for their size — likely on the rise">
                  ⭐ Rising star
                </span>
              )}
            </div>
            <div className="text-[12px] text-[#999] truncate">
              {profile.full_name}{profile.category ? ` · ${profile.category}` : ''}
              {growth && (
                <span className={`ml-1.5 font-medium ${growth.pct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {growth.pct >= 0 ? '▲' : '▼'} {Math.abs(growth.pct)}% · {growth.days}d
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            ['Followers', fmt(profile.followers)],
            ['Following', fmt(profile.following)],
            ['Posts', fmt(profile.posts)],
            ['Eng.', engagement != null ? `${engagement}%` : '—'],
          ].map(([k, v], idx) => (
            <div
              key={k}
              className="rounded-xl border border-[#eee] bg-[#fafafc] py-2.5 transition-all hover:-translate-y-0.5 hover:border-[#d9d2f7] hover:shadow-sm"
              style={{ animation: `ii-countup .4s ${idx * 0.06}s both` }}
            >
              <div className="text-[15px] font-bold tabular-nums text-[#111] leading-none">{v}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-[#999]">{k}</div>
            </div>
          ))}
        </div>

        {profile.biography && (
          <p className="mt-4 text-[13px] text-[#444] whitespace-pre-line leading-relaxed line-clamp-5">{profile.biography}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
          {profile.email && <a href={`mailto:${profile.email}`} className="text-[#10b981] hover:underline">✉ {profile.email}</a>}
          {profile.phone && <a href={`tel:${profile.phone}`} className="text-[#0ea5e9] hover:underline">📞 {profile.phone}</a>}
          {profile.external_url && <a href={profile.external_url} target="_blank" rel="noreferrer" className="text-[#888] hover:underline truncate max-w-[220px]">🔗 {profile.external_url.replace(/^https?:\/\//, '')}</a>}
        </div>

        {engagement != null && (
          <div
            className="mt-4 inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg text-[12px] font-medium"
            style={{ background: healthy ? '#ecfdf5' : '#fff7ed', color: healthy ? '#059669' : '#b45309', animation: 'ii-fadeup .4s .25s both' }}
          >
            {healthy ? '✓' : '⚠'} {engagement}% engagement — {healthy ? 'healthy' : 'low'} for this tier (benchmark ≈ {floor}%)
          </div>
        )}

        {rate && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-[#e3def9] bg-[#faf9ff] px-3.5 py-2.5" style={{ animation: 'ii-fadeup .4s .28s both' }}>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#999]">Est. rate / post</div>
              <div className="mt-0.5 text-[15px] font-bold text-[#111] tabular-nums">{inr(rate.low)} – {inr(rate.high)}</div>
            </div>
            <span className="text-[11px] text-[#aaa] text-right max-w-[120px] leading-tight">Indicative — IG in-feed, India</span>
          </div>
        )}

        {rhythm && (
          <div className="mt-3 grid grid-cols-3 gap-2" style={{ animation: 'ii-fadeup .4s .3s both' }}>
            {[
              ['📅', 'Cadence', rhythm.cadence],
              ['🔥', 'Best day', rhythm.bestDay],
              ['⏰', 'Best time', rhythm.bestWindow],
            ].map(([icon, label, val]) => (
              <div key={label} className="rounded-xl border border-[#eee] bg-[#fafafc] px-2.5 py-2 transition-all hover:-translate-y-0.5 hover:border-[#d9d2f7] hover:shadow-sm">
                <div className="text-[10px] uppercase tracking-wide text-[#999]">{icon} {label}</div>
                <div className="mt-0.5 text-[13px] font-semibold text-[#111] leading-tight">{val}</div>
              </div>
            ))}
          </div>
        )}

        {themes.length > 0 && (
          <div className="mt-3" style={{ animation: 'ii-fadeup .4s .35s both' }}>
            <div className="text-[10px] uppercase tracking-wide text-[#999] mb-1.5">Posts about</div>
            <div className="flex flex-wrap gap-1.5">
              {themes.map((t) => (
                <span key={t} className="px-2.5 py-1 rounded-full text-[12px] font-medium border border-[#e3def9] bg-[#f6f4ff]" style={{ color: ACCENT }}>{t}</span>
              ))}
            </div>
          </div>
        )}

        {collabs.length > 0 && (
          <div className="mt-3" style={{ animation: 'ii-fadeup .4s .38s both' }}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wide text-[#999]">
                Brand activity{profile.sponsored_posts ? ` · ${profile.sponsored_posts} sponsored` : ''}
              </div>
            </div>
            <input
              value={rivals}
              onChange={(e) => setRivals(e.target.value)}
              placeholder="Flag conflicts — your brand / competitors (comma-sep)"
              className="w-full mb-2 px-2.5 py-1.5 rounded-lg border border-[#e3def9] text-[12px] focus:outline-none focus:border-[#6C4DF6]"
            />
            {conflictCount > 0 && (
              <div className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-rose-50 text-rose-600">
                ⚠ {conflictCount} potential conflict{conflictCount > 1 ? 's' : ''} — recently tagged a competitor
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {collabs.map((c) => {
                const conflict = isRival(c.handle);
                return (
                  <a
                    key={c.handle}
                    href={`https://instagram.com/${c.handle}`}
                    target="_blank"
                    rel="noreferrer"
                    title={conflict ? 'Potential conflict' : `Tagged ${c.count}×`}
                    className={`px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${conflict ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-[#fafafc] border-[#eee] text-[#555] hover:border-[#d9d2f7]'}`}
                  >
                    {conflict && '⚠ '}@{c.handle}{c.count > 1 ? ` ·${c.count}` : ''}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-auto pt-5 flex gap-2">
          <button onClick={onDraft} className="px-4 py-2 rounded-lg text-white text-[13px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-lg hover:brightness-105" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
            ✦ Draft outreach
          </button>
          <a href={`https://instagram.com/${profile.handle}`} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg text-[13px] font-semibold border border-[#e3def9] transition-all hover:-translate-y-0.5 hover:bg-[#faf9ff]" style={{ color: ACCENT }}>
            Open Instagram ↗
          </a>
          <button onClick={copySummary} className="px-4 py-2 rounded-lg text-[13px] font-semibold border border-[#e3def9] transition-all hover:-translate-y-0.5 hover:bg-[#faf9ff]" style={{ color: copied ? '#059669' : ACCENT, borderColor: copied ? '#a7f3d0' : undefined }}>
            {copied ? '✓ Copied' : '⧉ Copy summary'}
          </button>
        </div>
      </div>

      {/* right: recent posts + similar creators */}
      <div className="flex flex-col gap-5">
        {profile.recent.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#999]">Recent posts</div>
            <div className="grid grid-cols-3 gap-2">
              {profile.recent.map((post, i) => (
                <a
                  key={i}
                  href={post.shortcode ? `https://instagram.com/p/${post.shortcode}` : `https://instagram.com/${profile.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-square rounded-xl overflow-hidden bg-[#eee] group ring-1 ring-black/5 hover:ring-2 hover:ring-[#6C4DF6]/40 transition-all"
                  title={post.caption}
                  style={{ animation: `ii-fadeup .4s ${0.1 + i * 0.04}s both` }}
                >
                  {post.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/ig-image?u=${encodeURIComponent(post.thumbnail)}`} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" />
                  )}
                  <div className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/55 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-white text-[11px] font-semibold drop-shadow">♥ {fmt(post.likes)} · 💬 {fmt(post.comments)}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {profile.related && profile.related.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#999]">Similar creators</div>
            <div className="flex flex-col gap-1.5">
              {profile.related.slice(0, 6).map((r, i) => (
                <button
                  key={r.handle}
                  onClick={() => onPivot(r.handle)}
                  className="group flex items-center gap-2.5 w-full text-left px-2 py-1.5 rounded-xl border border-transparent hover:border-[#e3def9] hover:bg-[#faf9ff] transition-all"
                  title={`Explore @${r.handle}`}
                  style={{ animation: `ii-fadeup .4s ${0.1 + i * 0.04}s both` }}
                >
                  <Avatar name={r.full_name || r.handle} url={r.profile_pic_url} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-[13px] font-semibold text-[#111] truncate">@{r.handle}{r.is_verified && <span style={{ color: ACCENT }}>✔</span>}</span>
                    {r.full_name && <span className="block text-[11px] text-[#999] truncate">{r.full_name}</span>}
                  </span>
                  <span className="ml-auto text-[14px] opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: ACCENT }}>→</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title, disabled }: { children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-8 h-8 grid place-items-center rounded-lg border border-[#e3def9] hover:bg-[#faf9ff] disabled:opacity-50 transition-colors"
      style={{ color: ACCENT }}
    >
      {children}
    </button>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const [err, setErr] = useState(false);
  if (url && !err) {
    // IG CDN blocks hotlinking — route through our server-side proxy.
    const src = `/api/ig-image?u=${encodeURIComponent(url)}`;
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        onError={() => setErr(true)}
        className="w-9 h-9 rounded-full object-cover shrink-0 bg-[#eee]"
      />
    );
  }
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return (
    <div
      className="w-9 h-9 rounded-full grid place-items-center text-white text-[12px] font-semibold shrink-0"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))` }}
    >
      {initials}
    </div>
  );
}
