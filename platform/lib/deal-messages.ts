// ============================================================
// Deal messages — the pure shaping layer for the per-deal brand↔creator thread.
// The routes fetch raw deal_messages rows; this turns them into a view keyed to
// the VIEWER (brand or creator): each message flagged mine/theirs, given a
// human timestamp, with day separators for a chat-like read. No DB, no writes —
// deterministic given the rows, the viewer and "now", so it stays testable.
// Mirrors the pure-builder pattern used across the deal libs.
// ============================================================

export type MessageSender = 'brand' | 'creator';

export interface MessageRow {
  id: string;
  sender: MessageSender;
  body: string;
  created_at: string;      // ISO
  read_at: string | null;  // ISO — set when the counterpart opened the thread
}

export interface MessageView {
  id: string;
  sender: MessageSender;
  mine: boolean;
  body: string;
  when: string;          // ISO (for ordering)
  time_label: string;    // "3:42 PM"
  day_label: string;     // "Today" / "Yesterday" / "3 Feb"
  show_day: boolean;     // first message of a new day
  read: boolean;         // only meaningful for `mine` messages
}

export interface MessageThread {
  available: boolean;
  viewer: MessageSender;
  counterpart_label: string;
  total: number;
  unread: number;        // messages from the counterpart the viewer hasn't seen
  last_at: string | null;
  items: MessageView[];
}

const MIN = 60_000;

function pad(n: number): string { return String(n).padStart(2, '0'); }

// IST-friendly clock label from an ISO timestamp.
function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

// Calendar day (YYYY-MM-DD) in IST, for day separators + "Today"/"Yesterday".
function istDay(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const ist = new Date(t + (5 * 60 + 30) * MIN);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

function dayLabel(dayISO: string, todayISO: string): string {
  const today = istDay(todayISO);
  if (dayISO === today) return 'Today';
  const y = new Date(today + 'T00:00:00Z').getTime() - 86_400_000;
  if (dayISO === new Date(y).toISOString().slice(0, 10)) return 'Yesterday';
  const d = new Date(dayISO + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? dayISO
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function buildMessageThread(
  rows: MessageRow[],
  viewer: MessageSender,
  counterpartLabel: string,
  nowISO: string,
): MessageThread {
  // Oldest → newest so the transcript reads top-to-bottom.
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const items: MessageView[] = [];
  let prevDay = '';
  let unread = 0;

  for (const m of sorted) {
    const mine = m.sender === viewer;
    if (!mine && !m.read_at) unread++;
    const day = istDay(m.created_at);
    items.push({
      id: m.id,
      sender: m.sender,
      mine,
      body: m.body,
      when: m.created_at,
      time_label: timeLabel(m.created_at),
      day_label: dayLabel(day, nowISO),
      show_day: day !== prevDay,
      read: !!m.read_at,
    });
    prevDay = day;
  }

  return {
    available: true,
    viewer,
    counterpart_label: counterpartLabel,
    total: items.length,
    unread,
    last_at: items.length ? items[items.length - 1]!.when : null,
    items,
  };
}

// Normalise a submitted message body: trim, collapse runaway blank lines, cap
// length. Returns null when there's nothing to send. Shared by both routes so
// the brand and creator POST paths validate identically.
export function normalizeMessageBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const body = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!body) return null;
  return body.slice(0, 4000);
}
