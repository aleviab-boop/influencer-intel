'use client';

import { useEffect, useRef, useState } from 'react';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Pack {
  concept: string;
  format: string;
  best_window: string;
  script: { scene: string; onscreen: string; voiceover: string }[];
  ideas: { title: string; desc: string }[];
  caption: string;
  hashtags: string[];
}

const EXAMPLES = [
  'summer pastel 15s body wash',
  'diwali gifting unboxing reel',
  'monsoon skincare GRWM 20s',
  'street food taste test 30s',
];

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));

export default function ContentIdeas() {
  const [prompt, setPrompt] = useState('');
  const [pack, setPack] = useState<Pack | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    if (autoRan.current) return;
    const q = new URLSearchParams(window.location.search).get('prompt');
    if (q && q.trim().length >= 3) {
      autoRan.current = true;
      void generate(q.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate(p?: string) {
    const q = (p ?? prompt).trim();
    if (q.length < 3 || loading) return;
    if (p) setPrompt(p);
    setLoading(true);
    setErr(null);
    try {
      const d = await fetch('/api/content-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: q }),
      }).then((r) => r.json());
      if (d.pack) setPack(d.pack as Pack);
      else setErr(d.error || 'Could not generate ideas.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function downloadPdf() {
    if (!pack) return;
    const w = window.open('', '_blank', 'width=840,height=1000');
    if (!w) return;
    const scriptRows = pack.script
      .map(
        (s) =>
          `<tr><td class="sc">${esc(s.scene)}</td><td><div class="os">${esc(s.onscreen)}</div><div class="vo">${esc(s.voiceover)}</div></td></tr>`,
      )
      .join('');
    const ideaItems = pack.ideas.map((i) => `<li><b>${esc(i.title)}</b> — ${esc(i.desc)}</li>`).join('');
    const tags = pack.hashtags.map((t) => esc(t)).join('  ');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Content Brief — ${esc(prompt)}</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e;margin:0;padding:40px 44px}
  .top{display:flex;align-items:center;gap:8px;margin-bottom:18px}
  .dot{width:22px;height:22px;border-radius:6px;background:${ACCENT}}
  .brand{font-weight:700;font-size:15px}
  h1{font-size:22px;margin:6px 0 2px} .tokens{color:#888;font-size:13px;margin-bottom:18px}
  .meta{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
  .chip{background:${ACCENT_SOFT};color:${ACCENT};font-size:12px;font-weight:600;padding:5px 10px;border-radius:8px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#999;margin:22px 0 8px}
  .concept{font-size:15px;font-weight:600}
  table{width:100%;border-collapse:collapse} td{border-bottom:1px solid #eee;padding:8px 6px;vertical-align:top;font-size:13px}
  .sc{width:70px;color:${ACCENT};font-weight:700;white-space:nowrap}
  .os{font-weight:600} .vo{color:#666;margin-top:2px}
  ul{margin:6px 0;padding-left:18px} li{font-size:13px;margin-bottom:5px}
  .cap{font-size:13px;background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px 12px;white-space:pre-wrap}
  .tags{color:${ACCENT};font-size:12px;margin-top:8px}
  .foot{margin-top:28px;border-top:1px solid #eee;padding-top:10px;color:#aaa;font-size:11px}
</style></head><body>
  <div class="top"><span class="dot"></span><span class="brand">Influencer Intel</span></div>
  <h1>${esc(pack.concept)}</h1>
  <div class="tokens">Brief: ${esc(prompt)}</div>
  <div class="meta"><span class="chip">${esc(pack.format)}</span><span class="chip">Best: ${esc(pack.best_window)}</span></div>
  <h2>Script</h2>
  <table>${scriptRows}</table>
  <h2>Alternative ideas</h2>
  <ul>${ideaItems}</ul>
  <h2>Caption</h2>
  <div class="cap">${esc(pack.caption)}</div>
  <div class="tags">${tags}</div>
  <div class="foot">Generated with Influencer Intel · Content Idea Generator</div>
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#111]">
      <MarketingNav />
      <main className="flex-1">
        <section className="py-12 md:py-16" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }}>
          <div className="max-w-3xl mx-auto px-6 text-center">
            <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>Content Idea Generator</span>
            <h1 className="mt-2 text-3xl md:text-5xl font-bold tracking-tight">From a few words to a full reel script</h1>
            <p className="mt-3 text-[16px] text-[#555]">
              Drop a few tokens — vibe, length, product — and get a scene-by-scene script, alternative concepts, a caption, and a downloadable PDF.
            </p>

            <div className="mt-7 rounded-2xl bg-white border-2 border-[#e3def9] p-3 shadow-[0_12px_50px_rgba(108,77,246,0.12)] focus-within:border-[#6C4DF6] transition-colors flex items-center gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && generate()}
                placeholder="e.g. summer pastel 15s body wash"
                className="flex-1 min-w-0 px-3 text-[16px] text-[#222] focus:outline-none bg-transparent"
                autoFocus
              />
              <button
                onClick={() => generate()}
                disabled={loading || prompt.trim().length < 3}
                className="px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold shrink-0 disabled:opacity-50 hover:brightness-105 flex items-center gap-2"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #F7B500)` }}
              >
                {loading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {loading ? 'Generating…' : '✦ Generate'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => generate(ex)} className="px-3 py-1.5 rounded-full border border-[#e3def9] text-[12px] hover:bg-[#faf9ff]" style={{ color: ACCENT }}>
                  {ex}
                </button>
              ))}
            </div>
            {err && <div className="mt-4 text-[13px] text-rose-600">{err}</div>}
          </div>
        </section>

        {pack && (
          <section className="max-w-3xl mx-auto px-6 py-10">
            <div className="rounded-2xl border border-[#eaeaea] shadow-[0_8px_40px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-6 py-5 flex items-start justify-between gap-4 border-b border-[#f0f0f0]">
                <div>
                  <div className="text-[18px] font-bold">{pack.concept}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="text-[12px] font-semibold px-2.5 py-1 rounded-lg" style={{ background: ACCENT_SOFT, color: ACCENT }}>{pack.format}</span>
                    <span className="text-[12px] font-semibold px-2.5 py-1 rounded-lg" style={{ background: ACCENT_SOFT, color: ACCENT }}>Best: {pack.best_window}</span>
                  </div>
                </div>
                <button onClick={downloadPdf} className="shrink-0 px-4 py-2 rounded-xl text-white text-[13px] font-semibold hover:brightness-105" style={{ background: `linear-gradient(135deg, ${ACCENT}, #F7B500)` }}>
                  ⬇ Download PDF
                </button>
              </div>

              <div className="p-6">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-2">Script</div>
                <div className="divide-y divide-[#f3f3f3]">
                  {pack.script.map((s, i) => (
                    <div key={i} className="flex gap-4 py-2.5" style={{ animation: `ii-fadeup .4s ${i * 0.05}s both` }}>
                      <div className="w-16 shrink-0 text-[13px] font-bold tabular-nums" style={{ color: ACCENT }}>{s.scene}</div>
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium text-[#111]">{s.onscreen}</div>
                        <div className="text-[13px] text-[#666] mt-0.5">{s.voiceover}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-2 mt-6">Alternative ideas</div>
                <ul className="space-y-2">
                  {pack.ideas.map((idea, i) => (
                    <li key={i} className="flex gap-2.5 text-[14px]">
                      <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: ACCENT }} />
                      <span><span className="font-semibold">{idea.title}</span> — <span className="text-[#666]">{idea.desc}</span></span>
                    </li>
                  ))}
                </ul>

                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-2 mt-6">Caption</div>
                <div className="rounded-xl border border-[#eee] bg-[#fafafa] p-3.5 text-[14px] whitespace-pre-wrap">{pack.caption}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pack.hashtags.map((t) => (
                    <span key={t} className="px-2.5 py-1 rounded-full text-[12px] font-medium border border-[#e3def9] bg-[#f6f4ff]" style={{ color: ACCENT }}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}
