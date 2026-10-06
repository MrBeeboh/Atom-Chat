#!/usr/bin/env node
/**
 * Standalone desktop host (127.0.0.1 only). The Vite plugin also mounts these
 * routes in the UI process, so this is optional unless you serve a production build.
 */
import http from 'node:http';
import process from 'node:process';
import { createDesktopHost, handleDesktopHostRequest } from './desktop-host-lib.mjs';
import { handleOpenScadRenderRequest } from './openscad-render.mjs';

const PORT = Number(process.env.ATOM_DESKTOP_HOST_PORT || 5176);
const host = createDesktopHost();

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.split('?')[0] === '/api/openscad-render') {
    Promise.resolve(handleOpenScadRenderRequest(req, res)).catch(() => {
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: 'render failed' }));
      }
    });
    return;
  }
  if (!url.startsWith('/api/desktop-host')) {
    req.url = `/api/desktop-host${url === '/' ? '/status' : url}`;
  }
  handleDesktopHostRequest(host, req, res, () => {
    res.statusCode = 404;
    res.end('Not found');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[desktop-host] http://127.0.0.1:${PORT}  root=${host.root}`);
});
