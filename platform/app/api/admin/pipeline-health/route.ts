import { NextResponse } from 'next/server';
import { igFetch } from '@/lib/ig-fetch';
import { notifySlack } from '@influencer-intel/shared/notify';

export const runtime = 'nodejs';

// GET /api/admin/pipeline-health
//   Health of the LIVE-DATA path (cookie scraper → relay → Instagram) — the
//   path the profile drawer uses, separate from the browser-worker crawl. Does
//   ONE lightweight authenticated fetch through igFetch (same relay + cookie the
//   drawer uses) and classifies the result. Cached ~60s so page polling never
//   adds more than ~1 IG request/min.

const APP_ID = '936619743392459';
const HEADERS: Record<string, string> = {
  'x-ig-app-id': APP_ID,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.instagram.com/',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

type Health = {
  status: 'healthy' | 'rate_limited' | 'cookie_dead' | 'relay_down' | 'no_relay' | 'no_cookie' | 'error';
  label: string;
  detail: string;
  httpCode: number | null;
  relayConfigured: boolean;
  cookieConfigured: boolean;
  checkedAt: string;
};

let cache: { at: number; data: Health } | null = null;
const TTL = 60_000;

// Slack alert de-dup: ping the operator the moment the drawer cookie starts
// getting rejected (401/403 = expired/logged-out session), but don't spam the
// channel on every poll while it stays dead. Re-alert at most once an hour, and
// arm a fresh alert once the cookie recovers (healthy again).
let cookieDeadAlertedAt = 0;
let cookieWasDead = false;
const ALERT_COOLDOWN = 60 * 60_000; // 1h

async function maybeAlertCookieDead(data: Health) {
  if (data.status === 'cookie_dead') {
    const now = Date.now();
    if (!cookieWasDead || now - cookieDeadAlertedAt > ALERT_COOLDOWN) {
      cookieDeadAlertedAt = now;
      await notifySlack(
        `:rotating_light: *IG drawer cookie rejected* — ${data.detail} (HTTP ${data.httpCode ?? '?'}). ` +
          `Live posts / ER in the profile drawer will be blank until a session is re-captured. ` +
          `Fix: \`npm run scraper:capture -- <handle>\` (writes a fresh session into the DB pool — no .env/Vercel change needed).`,
      );
    }
    cookieWasDead = true;
  } else if (data.status === 'healthy') {
    cookieWasDead = false; // recovered → re-arm the alert for the next death
  }
}

export async function GET() {
  const relayConfigured = !!process.env.IG_RELAY?.trim();
  const cookieConfigured = !!process.env.IG_SESSIONID?.trim();

  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json({ ...cache.data, cached: true });
  }

  let data: Health;
  if (!cookieConfigured) {
    data = { status: 'no_cookie', label: 'No cookie', detail: 'IG_SESSIONID not set — the drawer can’t fetch live data.', httpCode: null, relayConfigured, cookieConfigured, checkedAt: new Date().toISOString() };
  } else {
    let status: Health['status'] = 'error';
    let label = 'Unknown', detail = '', httpCode: number | null = null;
    // Best-of-2: web_profile_info on a single IP flaps between 200 and a
    // soft-throttle 400 (~1/3 of hits). One bad probe should NOT flip the whole
    // pipeline "down", so we retry once on any non-ok that isn't a hard
    // auth rejection and take the better outcome.
    let httpStatus = -1;
    let relayDown = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10_000);
        const res = await igFetch('https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram', { headers: HEADERS, signal: ctrl.signal });
        clearTimeout(t);
        httpStatus = res.status;
        relayDown = false;
        if (res.ok) break;                                   // got a good one — stop
        if (res.status === 401 || res.status === 403) break; // hard auth fail — no point retrying
      } catch {
        // igFetch throws / times out → relay (or network) is unreachable.
        httpStatus = -1;
        relayDown = true;
      }
    }

    httpCode = httpStatus > 0 ? httpStatus : null;
    if (httpStatus >= 200 && httpStatus < 300) {
      status = 'healthy'; label = 'Live data flowing'; detail = 'Cookie + relay working — drawers show live posts & engagement.';
    } else if (httpStatus === 401 || httpStatus === 403) {
      status = 'cookie_dead'; label = 'Cookie rejected'; detail = `Instagram rejected the session (HTTP ${httpStatus}) — re-capture an account: npm run scraper:capture -- <handle>.`;
    } else if (httpStatus === 429 || httpStatus === 400) {
      // 400/429 from web_profile_info is IG soft-throttling this IP, not a
      // broken pipeline — live data still flows, just intermittently.
      status = 'rate_limited'; label = 'Soft-throttled'; detail = `Instagram is soft-throttling this IP (HTTP ${httpStatus}) — live data still flows but some fetches will retry. Usually eases within 30–60 min.`;
    } else if (relayDown) {
      status = relayConfigured ? 'relay_down' : 'no_relay';
      label = relayConfigured ? 'Relay unreachable' : 'No relay';
      detail = relayConfigured
        ? 'The live fetch couldn’t reach Instagram — is the relay / tunnel running on the crawl host?'
        : 'No IG_RELAY set — production (data-center IP) can’t reach Instagram without it.';
    } else if (httpStatus >= 520 && httpStatus <= 530) {
      // 520–527 & 530 are Cloudflare EDGE errors, not Instagram responses (IG
      // never emits these). A 530 (Argo error 1033) means the relay's tunnel
      // origin isn't connected — the cloudflared tunnel on the crawl host is
      // down or mid-churn. Blaming Instagram here sends the operator chasing the
      // wrong thing; point them at the tunnel instead.
      status = 'relay_down';
      label = 'Relay tunnel down';
      detail = `The relay tunnel returned a Cloudflare error (HTTP ${httpStatus}) — the cloudflared tunnel on the crawl host is down or restarting, so live reads can’t reach it (the worker keeps crawling locally regardless). Restart the relay daemon on the host; it republishes a fresh URL to the DB and live data self-heals within ~60s.`;
    } else {
      status = 'error'; label = `HTTP ${httpStatus}`; detail = `Unexpected response (HTTP ${httpStatus}).`;
    }
    data = { status, label, detail, httpCode, relayConfigured, cookieConfigured, checkedAt: new Date().toISOString() };
  }

  cache = { at: Date.now(), data };
  // Fire the Slack alert on the freshly-computed classification (not on cache
  // hits — those return early above), so the operator hears about an expired
  // cookie within one poll cycle.
  await maybeAlertCookieDead(data);
  return NextResponse.json({ ...data, cached: false });
}
