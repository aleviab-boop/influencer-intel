'use client';

import { useState } from 'react';

const ACCENT = '#6C4DF6';

const inp =
  'w-full px-3.5 py-2.5 rounded-xl border border-[#e3def9] text-[14px] text-[#222] bg-white focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all';

export function BookDemoButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          className ??
          'px-4 py-2 rounded-lg text-white text-[14px] font-medium transition-all hover:-translate-y-0.5 hover:shadow-lg'
        }
        style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
      >
        Book a demo
      </button>
      {open && <BookDemoModal onClose={() => setOpen(false)} />}
    </>
  );
}

function BookDemoModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [team, setTeam] = useState('');
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !/.+@.+\..+/.test(email) || !company.trim()) {
      setErr('Please add your name, a valid work email, and your company.');
      return;
    }
    setErr(null);
    setLoading(true);
    // Best-effort save; the confirmation always shows once the form is valid.
    void fetch('/api/demo-leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, company, team_size: team, goal }),
    }).catch(() => {});
    window.setTimeout(() => {
      setLoading(false);
      setDone(true);
    }, 550);
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <style>{`@keyframes ii-pop{from{opacity:0;transform:scale(.96) translateY(10px)}to{opacity:1;transform:none}}`}</style>
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-[0_30px_80px_rgba(20,20,60,0.3)] overflow-hidden"
        style={{ animation: 'ii-pop .25s both' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${ACCENT}, #9b7bff)` }} />

        {done ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto rounded-full grid place-items-center mb-4 bg-emerald-50" style={{ animation: 'ii-pop .35s both' }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10" /></svg>
            </div>
            <h3 className="text-xl font-bold text-[#111]">You’re all set! 🎉</h3>
            <p className="mt-2 text-[14px] text-[#666] leading-relaxed">
              Thanks{name ? `, ${name.split(' ')[0]}` : ''} — our team will contact you shortly.
            </p>
            <button
              onClick={onClose}
              className="mt-6 px-6 py-2.5 rounded-xl text-white text-[14px] font-semibold hover:brightness-105"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-[19px] font-bold text-[#111]">Book a demo</h3>
                <p className="mt-1 text-[13px] text-[#666]">See Influencer Intel in action — tailored to your brand.</p>
              </div>
              <button type="button" onClick={onClose} className="text-[#999] hover:text-[#111] text-xl leading-none -mt-1">×</button>
            </div>

            <div className="mt-5 space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={inp} autoFocus />
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Work email" className={inp} />
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className={inp} />
              <select value={team} onChange={(e) => setTeam(e.target.value)} className={`${inp} ${team ? '' : 'text-[#999]'}`}>
                <option value="">Team size (optional)</option>
                <option value="Just me">Just me</option>
                <option value="2-10">2–10</option>
                <option value="11-50">11–50</option>
                <option value="50+">50+</option>
              </select>
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="What are you hoping to achieve? (optional)" className={`${inp} resize-none`} />
            </div>

            {err && <div className="mt-3 text-[13px] text-rose-600">{err}</div>}

            <button
              type="submit"
              disabled={loading}
              className="mt-5 w-full px-4 py-3 rounded-xl text-white text-[14px] font-semibold flex items-center justify-center gap-2 hover:brightness-105 disabled:opacity-70"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              {loading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
              {loading ? 'Sending…' : 'Request demo'}
            </button>
            <p className="mt-3 text-center text-[11px] text-[#aaa]">No spam — we’ll only reach out about your demo.</p>
          </form>
        )}
      </div>
    </div>
  );
}
