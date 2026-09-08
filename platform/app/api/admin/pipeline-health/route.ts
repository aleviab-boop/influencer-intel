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
  status: 'healthy' | 'rate_limited' | 'cookie_dead' | 'relay_key_mismatch' | 'relay_down' | 'no_relay' | 'no_cookie' | 'error';
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

// Throttle hysteresis: web_profile_info on a hot target (the `instagram` account)
// soft-throttles with an intermittent HTTP 400 on roughly 1-in-3 hits EVEN WHILE
// real drawer fetches succeed — so a lone bad probe is noise, not a broken
// pipeline. We only surface the "Soft-throttled" banner once the throttle is
// SUSTAINED across several consecutive fresh checks; a single/occasional blip
// stays "healthy" because live data is still flowing. This is what kills the
// near-constant false banner (page re-polls every 30s and kept catching blips).
let throttleStreak = 0;
const THROTTLE_STREAK_TO_ALERT = 3; // ~3 fresh checks × 60s TTL ≈ a few sustained minutes

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
    // Best-of-3: web_profile_info on a single IP flaps between 200 and a
    // soft-throttle 400 (~1/3 of hits). One bad probe should NOT flip the whole
    // pipeline "down", so we retry on any non-ok that isn't a hard auth
    // rejection and take the better outcome. Three tries drops the odds of a
    // pure-noise all-fail cycle from ~1/9 to ~1/27.
    let httpStatus = -1;
    let relayDown = false;
    let authBody = ''; // body of a 401/403 — lets us tell the relay's plaintext
                       // "unauthorized" (key mismatch) from IG's JSON (dead cookie)
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10_000);
        const res = await igFetch('https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram', { headers: HEADERS, signal: ctrl.signal });
        clearTimeout(t);
        httpStatus = res.status;
        relayDown = false;
        if (res.ok) break;                                   // got a good one — stop
        if (res.status === 401 || res.status === 403) {      // hard auth fail — no point retrying
          try { authBody = (await res.text()).slice(0, 200); } catch { /* body already consumed / stream error */ }
          break;
        }
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
      // A 401/403 can come from two very different places on this path:
      //   • the RELAY, rejecting a wrong/missing x-relay-key — it replies with a
      //     plaintext "unauthorized" body (see tools/ig-relay.mjs). The cookie is
      //     fine; live data is blocked purely because Vercel's IG_RELAY_KEY ≠ the
      //     host's RELAY_KEY.
      //   • INSTAGRAM, rejecting the session cookie — it replies with JSON.
      // Blaming the cookie for a relay-key mismatch sends the operator to
      // re-capture a perfectly good session (and fires a false "cookie dead"
      // Slack alert), so disambiguate on the body: the relay's is non-JSON and
      // literally "unauthorized".
      const relayReject = /unauthorized/i.test(authBody) && !authBody.trim().startsWith('{');
      if (relayReject) {
        status = 'relay_key_mismatch';
        label = 'Relay key mismatch';
        detail = `The relay rejected this request (HTTP ${httpStatus} “unauthorized”) — Vercel’s IG_RELAY_KEY doesn’t match the relay host’s RELAY_KEY. The cookie is fine; live data is blocked until the keys match. Set IG_RELAY_KEY on Vercel to the host’s RELAY_KEY value, then redeploy.`;
      } else {
        status = 'cookie_dead'; label = 'Cookie rejected'; detail = `Instagram rejected the session (HTTP ${httpStatus}) — re-capture an account: npm run scraper:capture -- <handle>.`;
      }
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

    // Throttle hysteresis (see note by throttleStreak): only surface the
    // "Soft-throttled" banner once the throttle is sustained across several
    // consecutive fresh checks. A lone/occasional 400/429 from the flaky probe
    // endpoint is downgraded to "healthy" because live data is still flowing —
    // this is what stops the near-constant false banner.
    if (status === 'rate_limited') {
      throttleStreak++;
      if (throttleStreak < THROTTLE_STREAK_TO_ALERT) {
        status = 'healthy';
        label = 'Live data flowing';
        detail = `Cookie + relay working — drawers show live posts & engagement. (A health probe soft-throttled on HTTP ${httpCode}, but that endpoint flaps intermittently and real fetches are unaffected; retrying transparently.)`;
      }
    } else {
      // any non-throttle outcome (healthy, cookie_dead, relay_down, …) breaks the
      // streak so a future lone blip starts counting fresh
      throttleStreak = 0;
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
