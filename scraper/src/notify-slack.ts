// Fire-and-forget Slack alert via an incoming webhook. No-op when
// SLACK_WEBHOOK_URL isn't set, so it's safe to call unconditionally. Used to
// ping the operator the moment an account dies (so it can be re-captured)
// without having to watch the terminal or the admin page.
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
    /* best-effort — never let an alert failure affect the crawl */
  }
}
