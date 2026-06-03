'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';

interface JobRow {
  id: string;
  target_handle: string;
  status: string;
  attempts: number;
  queued_at: string;
  completed_at: string | null;
  error_message: string | null;
  follower_count: string | null;
  is_active: boolean | null;
  has_vision: boolean | null;
}

export default function ResearchPage() {
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ queued: string[]; skipped: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch('/api/research');
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setJobs(d.jobs ?? []);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  async function submit() {
    if (!input.trim()) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles: input }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Failed');
      setResult({ queued: data.queued ?? [], skipped: data.skipped ?? [] });
      setInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas">
      <AppHeader />

      <section className="max-w-4xl mx-auto px-6 pt-10 pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900 mb-1">
          Research creators
        </h1>
        <p className="text-ink-600 text-body">
          Paste IG handles, profile URLs, or @-tags — one or many. We&apos;ll deep-scrape each and
          extract the full 50+ field profile with vision insights.
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-6">
        <div className="rounded-[14px] border border-border bg-surface p-5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`@masoomminawala\n@komalpandeyofficial\nhttps://instagram.com/aashnashroff\nmostlysane, sejalkumar1195`}
            rows={8}
            className="w-full px-4 py-3 rounded-[10px] bg-canvas border border-border text-sm font-mono text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-ink-400 resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-[12px] text-ink-400">
              Up to 50 per submission · separated by space, comma, or newline · {' '}
              <kbd className="px-1.5 py-0.5 rounded bg-canvas border border-border text-[11px] text-ink-600">⌘⏎</kbd>
              {' '}to submit
            </span>
            <button
              onClick={submit}
              disabled={submitting || !input.trim()}
              className="px-4 py-2 rounded-[10px] bg-ink-900 text-white text-sm font-medium hover:bg-ink-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Queueing…' : 'Research'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 px-4 py-3 rounded-[10px] bg-canvas border border-danger/30 text-danger text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-3 px-4 py-3 rounded-[10px] bg-success/5 border border-success/30 text-sm">
            <div className="text-success font-medium mb-1">
              Queued {result.queued.length} creators
              {result.skipped.length > 0 && ` · ${result.skipped.length} already in flight`}
            </div>
            {result.queued.length > 0 && (
              <div className="text-ink-600 font-mono text-[12px]">
                {result.queued.map((h) => `@${h}`).join('  ')}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-16">
        <h2 className="text-base font-medium text-ink-900 mb-3">Recent research jobs</h2>
        {jobs.length === 0 ? (
          <div className="rounded-[14px] border border-border bg-surface p-8 text-center text-ink-600">
            No research jobs yet. Paste a handle above to start.
          </div>
        ) : (
          <div className="space-y-1.5">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function JobRow({ job }: { job: JobRow }) {
  const completed = job.status === 'completed';
  const failed = job.status === 'failed';
  const inProgress = job.status === 'in_progress' || job.status === 'queued';
  const followers = job.follower_count ? Number(job.follower_count) : null;

  const inner = (
    <div className="rounded-[10px] border border-border bg-surface px-4 py-3 flex items-center gap-3">
      <Dot completed={completed} failed={failed} inProgress={inProgress} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-ink-900">@{job.target_handle}</span>
          {completed && followers != null && (
            <span className="text-[11px] text-ink-600 tabular-nums">
              · {formatFollowers(followers)} followers
            </span>
          )}
          {completed && job.has_vision && (
            <span className="text-[11px] text-success">· vision ✓</span>
          )}
          {completed && job.is_active === false && (
            <span className="text-[11px] text-ink-400">· deactivated (low signal)</span>
          )}
        </div>
        <div className="text-[11px] text-ink-400 mt-0.5">
          {failed && job.error_message ? (
            <span className="text-danger">{job.error_message}</span>
          ) : (
            <>
              {job.status} · queued {relativeTime(new Date(job.queued_at))}
              {job.completed_at && ` · finished ${relativeTime(new Date(job.completed_at))}`}
              {job.attempts > 1 && ` · attempt ${job.attempts}/3`}
            </>
          )}
        </div>
      </div>
      {completed && job.is_active !== false && (
        <span className="text-ink-400 text-sm">→</span>
      )}
    </div>
  );

  if (completed && job.is_active !== false) {
    return (
      <Link href={`/creators/${encodeURIComponent(job.target_handle)}`} className="block hover:opacity-90">
        {inner}
      </Link>
    );
  }
  return inner;
}

function Dot({ completed, failed, inProgress }: { completed: boolean; failed: boolean; inProgress: boolean }) {
  if (completed) return <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />;
  if (failed) return <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />;
  if (inProgress) return <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse shrink-0" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-ink-300 shrink-0" />;
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
