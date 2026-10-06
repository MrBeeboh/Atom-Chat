/**
 * Localhost-only OpenSCAD PNG render. One fresh `docker run --rm` per request.
 * Network none, read-only root, writable scratch dir only. Does not touch other containers.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const OPENSCAD_IMAGE = 'openscad/openscad:latest';
export const RENDER_TIMEOUT_MS = 60_000;
export const MAX_SOURCE_BYTES = 48 * 1024;

export function isLocalAddress(addr) {
  if (!addr) return false;
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr === 'localhost'
  );
}

function oneLine(text) {
  const line = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .pop() || 'render failed';
  return line.replace(/\s+/g, ' ').slice(0, 160);
}

function runDocker(args, timeoutMs, name) {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const cap = 8000;
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-cap);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-cap);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      spawn('docker', ['kill', name], { stdio: 'ignore' }).on('error', () => {});
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err?.message || 'docker failed', timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut ? 'render timed out' : stderr,
        timedOut,
      });
    });
  });
}

/**
 * @param {string} source OpenSCAD source
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function renderOpenScadPng(source) {
  const text = String(source ?? '');
  if (!text.trim()) {
    const err = new Error('empty OpenSCAD source');
    err.status = 400;
    throw err;
  }
  if (text.includes('\0') || Buffer.byteLength(text) > MAX_SOURCE_BYTES) {
    const err = new Error('OpenSCAD source rejected');
    err.status = 400;
    throw err;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-scad-'));
  const name = `atom-scad-${crypto.randomBytes(6).toString('hex')}`;
  await fs.writeFile(path.join(dir, 'in.scad'), text, 'utf8');
  const args = [
    'run', '--rm', '--init',
    '--name', name,
    '--network', 'none',
    '--read-only',
    '--cap-drop', 'ALL',
    '--cap-add', 'DAC_READ_SEARCH',
    '--cap-add', 'DAC_OVERRIDE',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '256',
    '--memory', '1g',
    '--tmpfs', '/tmp:rw,nosuid,size=128m',
    '-e', 'HOME=/tmp',
    '-e', 'XDG_CACHE_HOME=/tmp',
    '-v', `${dir}:/work`,
    '-w', '/work',
    OPENSCAD_IMAGE,
    'xvfb-run', '-a',
    'openscad',
    '-o', '/work/out.png',
    '--imgsize=800,600',
    '/work/in.scad',
  ];
  try {
    const result = await runDocker(args, RENDER_TIMEOUT_MS, name);
    const pngPath = path.join(dir, 'out.png');
    let png;
    try {
      png = await fs.readFile(pngPath);
    } catch {
      png = null;
    }
    if (result.code !== 0 || !png || png.length < 32 || png.subarray(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') {
      const err = new Error(oneLine(result.stderr || result.stdout || 'render failed'));
      err.status = result.timedOut ? 504 : 500;
      throw err;
    }
    return png;
  } finally {
    spawn('docker', ['rm', '-f', name], { stdio: 'ignore' }).on('error', () => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function readJsonBody(req, limit = MAX_SOURCE_BYTES + 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Handles POST /api/openscad-render. Returns true when this request is ours.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleOpenScadRenderRequest(req, res) {
  const pathname = (req.url || '').split('?')[0];
  if (pathname !== '/api/openscad-render') return false;

  const sendJson = (status, body) => {
    const payload = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(payload);
  };

  if (!isLocalAddress(req.socket?.remoteAddress)) {
    sendJson(403, { ok: false, error: 'localhost only' });
    return true;
  }
  if ((req.method || 'GET') !== 'POST') {
    sendJson(405, { ok: false, error: 'POST only' });
    return true;
  }
  try {
    const body = await readJsonBody(req);
    const png = await renderOpenScadPng(body?.source);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(png.length));
    res.end(png);
  } catch (err) {
    if (!res.headersSent && !res.writableEnded) {
      sendJson(err?.status || 500, { ok: false, error: oneLine(err?.message || 'render failed') });
    }
  }
  return true;
}
