import fs from 'node:fs';
import path from 'node:path';
import { appendArenaRecord } from '../src/lib/arenaRecordStore.js';

/**
 * Writes arena session PDFs under arena-reports/. Does not touch model files.
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
          if (!file.endsWith('.pdf')) {
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
          res.setHeader('Content-Type', 'application/pdf');
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
            if (!/^arena-session-[\w.-]+\.pdf$/.test(file)) throw new Error('bad name');
            const buf = Buffer.from(String(json.pdfBase64 || ''), 'base64');
            if (buf.length < 5 || buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('not a pdf');
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
