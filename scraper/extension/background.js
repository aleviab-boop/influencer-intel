// ============================================================
// Background service worker
// Receives EXTRACT_RESULT messages from content scripts and
// forwards them to a localhost endpoint that the scraper
// orchestrator listens on (orchestrator.ts → http server).
// ============================================================

const ORCHESTRATOR_URL = 'http://127.0.0.1:7457/extension-result';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'EXTRACT_RESULT') return;
  fetch(ORCHESTRATOR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg.payload),
  })
    .then((res) => res.text())
    .then((text) => {
      console.log('[bg] orchestrator ack:', text);
      sendResponse({ ok: true });
    })
    .catch((err) => {
      console.error('[bg] orchestrator forward failed:', err);
      sendResponse({ ok: false, error: String(err) });
    });
  return true; // async response
});
