import fs from 'node:fs';
import path from 'node:path';
import { appendArenaRecord } from '../src/lib/arenaRecordStore.js';

/**
 * Writes arena session reports (HTML pages that print to PDF) under arena-reports/. Does not touch model files.
 * @param {string} root app root
 */
export function vitePluginArenaReport(root) {
  const dir = path.resolve(root, 'arena-reports');
  return {
    name: 'atom-arena-report',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/atom-arena-report')) return next();
        if (req.method === 'GET') {
          const file = path.basename(new URL(url, 'http://localhost').searchParams.get('file') || '');
          if (!/\.(html|pdf)$/.test(file)) {
            res.statusCode = 400;
            res.end('bad file');
            return;
          }
          const full = path.join(dir, file);
          if (!fs.existsSync(full)) {
            res.statusCode = 404;
            res.end('missing');
            return;
          }
          if (file.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
          } else {
            res.setHeader('Content-Type', 'application/pdf');
          }
          fs.createReadStream(full).pipe(res);
          return;
        }
        if (req.method !== 'POST') return next();
        const chunks = [];
        req.on('data', (c) => {
          chunks.push(c);
          const size = chunks.reduce((n, b) => n + b.length, 0);
          if (size > 20_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            const file = path.basename(String(json.filename || ''));
            if (!/^arena-session-[\w.-]+\.html$/.test(file)) throw new Error('bad name');
            const html = String(json.html || '');
            if (!/^<!doctype html>/i.test(html)) throw new Error('not an html report');
            const buf = Buffer.from(html, 'utf8');
            fs.mkdirSync(dir, { recursive: true });
            const full = path.join(dir, file);
            fs.writeFileSync(full, buf);
            let recordError = null;
            if (json.record && typeof json.record === 'object') {
              try {
                appendArenaRecord(path.join(dir, 'arena-models.sqlite'), json.record);
              } catch (err) {
                recordError = err?.message || 'record failed';
              }
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: full, filename: file, recordError }));
          } catch (e) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: e?.message || 'bad report' }));
          }
        });
      });
    },
  };
}
