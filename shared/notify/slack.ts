// Fire-and-forget Slack alert via an incoming webhook (SLACK_WEBHOOK_URL).
// No-op when the webhook isn't set, so it's safe to call unconditionally.
// Shared by every "operator, act now" signal so they all land in one channel:
//   - the crawl worker  → an IG account died / got parked
//   - pipeline-health    → the drawer cookie (IG_SESSIONID) is rejected/expired
//   - the Fetcher        → the drawer cookie died mid-bulk-fetch
export async function notifySlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    /* best-effort — never let an alert failure break the caller */
  }
}
