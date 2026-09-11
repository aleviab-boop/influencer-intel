// Client-side "hand off to the user's own mail" links. Mirrors the UPI-intent
// pattern used for payouts: we don't send the mail ourselves, we pre-fill a
// compose window and let the user send it from their own account — so it goes
// from their real address, lands in their Sent folder, and replies come back to
// them. No API key, no domain verification, works today.
//
// This is THE email path on this platform — delivery is manual by design (there
// is no automated sender). The outreach routes signal `needs_handoff` and the
// client opens one of these compose windows so the user sends the message
// themselves.

// Gmail web compose — opens in whatever Google account the browser is signed
// into. Best when the user lives in Gmail (most of our users do).
export function gmailComposeLink(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

// Universal mailto: — opens the OS default mail client. A safe fallback for
// users who don't use Gmail web.
export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Open a Gmail compose tab for this draft. Returns true if a tab was opened
// (popup-blockers can return null), so callers can decide whether to advance
// the pipeline. Must be called directly from a user gesture (click) or the
// browser will block the popup.
export function openGmailCompose(to: string, subject: string, body: string): boolean {
  const w = window.open(gmailComposeLink(to, subject, body), '_blank', 'noopener,noreferrer');
  return !!w;
}
