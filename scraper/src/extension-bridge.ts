// ============================================================
// Extension bridge — runs a tiny HTTP server on localhost:7457
// that the Chrome extension's background.js POSTs extracted
// data to. Resolves a Promise that the scraper is awaiting.
// ============================================================

import http from 'node:http';
import type { ExtensionExtractionResult } from '@influencer-intel/shared/types';

type Resolver = (data: ExtensionExtractionResult) => void;

class ExtensionBridge {
  private server: http.Server | null = null;
  private waiters = new Map<string, Resolver>(); // keyed by handle

  async start(port = 7457): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/extension-result') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as ExtensionExtractionResult;
            const resolver = this.waiters.get(payload.handle.toLowerCase());
            if (resolver) {
              resolver(payload);
              this.waiters.delete(payload.handle.toLowerCase());
            }
            res.writeHead(200);
            res.end('ok');
          } catch (err) {
            console.error('[bridge] parse failed', err);
            res.writeHead(400);
            res.end('bad request');
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    console.log(`[bridge] listening on http://127.0.0.1:${port}`);
  }

  /** Wait for the next extraction with the given handle (case-insensitive). */
  awaitExtraction(handle: string, timeoutMs = 30_000): Promise<ExtensionExtractionResult> {
    const key = handle.toLowerCase();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(key);
        reject(new Error(`Extension extraction timeout for ${handle}`));
      }, timeoutMs);
      this.waiters.set(key, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server!.close((err) => (err ? reject(err) : resolve())),
    );
    this.server = null;
  }
}

let cached: ExtensionBridge | null = null;

export function getExtensionBridge(): ExtensionBridge {
  if (!cached) cached = new ExtensionBridge();
  return cached;
}
