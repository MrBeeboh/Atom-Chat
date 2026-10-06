/**
 * Local desktop host: list/read/write files under the user's Documents folder.
 * Writes require a one-time in-memory grant per process (one Atom session).
 * Print jobs are allowlisted binaries (OpenSCAD, slice_print.py) — never a shell.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';

export const MAX_READ_BYTES = 256 * 1024;
export const MAX_WRITE_BYTES = 512 * 1024;
export const MAX_LIST_ENTRIES = 400;
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_JOB_LOG_CHARS = 16 * 1024;
export const OPENSCAD_TIMEOUT_MS = 180_000;
export const SLICE_TIMEOUT_MS = 600_000;
export const START_PRINT_TIMEOUT_MS = 20_000;
export const DEFAULT_MOONRAKER_URL = 'http://192.168.0.18:7125';
export const SAFE_JOB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
export const SAFE_DEFINE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const SAFE_DEFINE_STRING = /^[A-Za-z0-9_./+-]{0,120}$/;

export class DesktopHostError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'DesktopHostError';
    this.code = code;
    this.status = status;
  }
}

export function defaultDocumentsRoot() {
  return path.join(os.homedir(), 'Documents');
}

function deny(code, message, status = 403) {
  throw new DesktopHostError(code, message, status);
}

export function isLocalAddress(addr) {
  if (!addr) return false;
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr === 'localhost'
  );
}

export function findExecutable(name, extraPaths = []) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw) && fsSync.existsSync(raw)) return raw;
  const dirs = [...extraPaths, ...(process.env.PATH || '').split(path.delimiter)];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, raw);
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return '';
}

export function moonrakerOrigin(raw = process.env.ATOM_MOONRAKER_URL || DEFAULT_MOONRAKER_URL) {
  let parsed;
  try {
    parsed = new URL(String(raw));
  } catch {
    throw new DesktopHostError('CONFIG', 'Invalid ATOM_MOONRAKER_URL.', 500);
  }
  if (parsed.protocol !== 'http:') {
    throw new DesktopHostError('CONFIG', 'Moonraker URL must be http.', 500);
  }
  if (parsed.username || parsed.password) {
    throw new DesktopHostError('CONFIG', 'Moonraker URL must not include credentials.', 500);
  }
  return parsed.origin;
}

export function requireJobName(name) {
  const value = String(name ?? '').trim();
  if (!SAFE_JOB_NAME.test(value)) {
    deny('INVALID_NAME', 'name must be letters, digits, dot, underscore, or hyphen.');
  }
  return value;
}

export function serializeOpenScadDefine(key, value) {
  if (!SAFE_DEFINE_KEY.test(key)) {
    deny('INVALID_DEFINE', `Invalid OpenSCAD define name: ${key}`);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return `${key}=${value}`;
  if (typeof value === 'boolean') return `${key}=${value ? 'true' : 'false'}`;
  if (typeof value === 'string') {
    if (!SAFE_DEFINE_STRING.test(value)) {
      deny('INVALID_DEFINE', `Invalid OpenSCAD define value for ${key}.`);
    }
    return `${key}="${value}"`;
  }
  deny('INVALID_DEFINE', `Unsupported OpenSCAD define type for ${key}.`);
}

export function serializeOpenScadDefines(defines) {
  if (defines == null) return [];
  if (typeof defines !== 'object' || Array.isArray(defines)) {
    deny('INVALID_DEFINE', 'defines must be an object of name → value.');
  }
  return Object.entries(defines).map(([key, value]) => serializeOpenScadDefine(key, value));
}

function requireExtension(filePath, ext) {
  const lower = String(filePath || '').toLowerCase();
  if (!lower.endsWith(ext)) {
    deny('INVALID_PATH', `Path must end with ${ext}.`);
  }
}

export function clipJobLog(text) {
  const s = String(text || '');
  if (s.length <= MAX_JOB_LOG_CHARS) return s;
  return s.slice(-MAX_JOB_LOG_CHARS);
}

export function spawnArgv(command, args, { cwd, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const cap = MAX_JOB_LOG_CHARS * 2;
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > cap) stdout = stdout.slice(-cap);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > cap) stderr = stderr.slice(-cap);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs || OPENSCAD_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: code ?? (signal ? 1 : 0),
        signal: signal || null,
        stdout: clipJobLog(stdout),
        stderr: clipJobLog(stderr),
      });
    });
  });
}

export function createDesktopHost({ root, runArgv, fetchImpl, binaries } = {}) {
  const requested = path.resolve(root || defaultDocumentsRoot());
  if (!fsSync.existsSync(requested)) {
    fsSync.mkdirSync(requested, { recursive: true });
  }
  const resolvedRoot = fsSync.realpathSync(requested);
  let writesGranted = false;
  let jobsGranted = false;
  let startGranted = false;
  const run = typeof runArgv === 'function' ? runArgv : spawnArgv;
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch.bind(globalThis);

  const openscadBin = binaries?.openscad || process.env.ATOM_OPENSCAD || findExecutable('openscad');
  const pythonBin = binaries?.python || process.env.ATOM_PYTHON || findExecutable('python3');
  const slicePrintPath = path.resolve(
    binaries?.slicePrint || path.join(resolvedRoot, '3d_Printing', 'PRINTS', 'slice_print.py'),
  );
  let moonraker;
  try {
    moonraker = moonrakerOrigin(binaries?.moonrakerUrl || process.env.ATOM_MOONRAKER_URL || DEFAULT_MOONRAKER_URL);
  } catch {
    moonraker = '';
  }

  function status() {
    const sliceOk = slicePrintPath.startsWith(resolvedRoot + path.sep) && fsSync.existsSync(slicePrintPath);
    return {
      ok: true,
      root: resolvedRoot,
      writesGranted,
      jobsGranted,
      startGranted,
      jobs: {
        openscad: openscadBin || null,
        python: pythonBin || null,
        slice_print: sliceOk ? slicePrintPath : null,
        moonraker: moonraker || null,
      },
    };
  }

  function grantWrites() {
    writesGranted = true;
    return status();
  }

  function revokeWrites() {
    writesGranted = false;
    return status();
  }

  function grantJobs() {
    jobsGranted = true;
    return status();
  }

  function revokeJobs() {
    jobsGranted = false;
    return status();
  }

  function grantStart() {
    startGranted = true;
    return status();
  }

  function revokeStart() {
    startGranted = false;
    return status();
  }

  function logicalPath(absPath) {
    const rel = path.relative(resolvedRoot, absPath);
    if (!rel || rel === '.') return '.';
    return rel.split(path.sep).join('/');
  }

  async function resolveInRoot(userPath, { mustExist } = {}) {
    const raw = String(userPath ?? '').trim() || '.';
    if (raw.includes('\0')) deny('INVALID_PATH', 'Invalid path.');
    const candidate = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(resolvedRoot, raw);
    const rel = path.relative(resolvedRoot, candidate);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      deny('OUTSIDE_ROOT', 'Path is outside the Documents folder.');
    }

    try {
      const real = await fs.realpath(candidate);
      const realRel = path.relative(resolvedRoot, real);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        deny('OUTSIDE_ROOT', 'Path is outside the Documents folder.');
      }
      return real;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      if (mustExist) deny('NOT_FOUND', `Not found: ${logicalPath(candidate)}`, 404);
      const parent = path.dirname(candidate);
      let realParent;
      try {
        realParent = await fs.realpath(parent);
      } catch (parentErr) {
        if (parentErr?.code === 'ENOENT') {
          deny('NOT_FOUND', `Parent folder does not exist: ${logicalPath(parent)}`, 404);
        }
        throw parentErr;
      }
      const parentRel = path.relative(resolvedRoot, realParent);
      if (parentRel.startsWith('..') || path.isAbsolute(parentRel)) {
        deny('OUTSIDE_ROOT', 'Path is outside the Documents folder.');
      }
      return path.join(realParent, path.basename(candidate));
    }
  }

  async function listDir({ path: userPath = '.' } = {}) {
    const abs = await resolveInRoot(userPath, { mustExist: true });
    const st = await fs.stat(abs);
    if (!st.isDirectory()) deny('NOT_A_DIRECTORY', 'Not a directory.');
    const names = await fs.readdir(abs);
    const entries = [];
    for (const name of names) {
      if (entries.length >= MAX_LIST_ENTRIES) break;
      const child = path.join(abs, name);
      let type = 'other';
      let size = 0;
      try {
        const cst = await fs.lstat(child);
        if (cst.isDirectory()) type = 'dir';
        else if (cst.isFile()) type = 'file';
        else if (cst.isSymbolicLink()) type = 'symlink';
        size = cst.isFile() ? cst.size : 0;
      } catch {
        continue;
      }
      entries.push({ name, type, size });
    }
    entries.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });
    return {
      ok: true,
      path: logicalPath(abs),
      entries,
      truncated: names.length > entries.length,
    };
  }

  async function readFileTool({ path: userPath, max_bytes } = {}) {
    if (!userPath) deny('INVALID_PATH', 'path is required.');
    const abs = await resolveInRoot(userPath, { mustExist: true });
    const st = await fs.stat(abs);
    if (!st.isFile()) deny('NOT_A_FILE', 'Not a file.');
    const limit = Math.min(MAX_READ_BYTES, Number(max_bytes) > 0 ? Number(max_bytes) : MAX_READ_BYTES);
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) {
      deny('BINARY', 'Binary files are not readable as text.');
    }
    const truncated = buf.length > limit;
    const slice = truncated ? buf.subarray(0, limit) : buf;
    return {
      ok: true,
      path: logicalPath(abs),
      bytes: buf.length,
      truncated,
      content: slice.toString('utf8'),
    };
  }

  async function writeFileTool({ path: userPath, content } = {}) {
    if (!writesGranted) {
      deny('WRITE_GRANT_REQUIRED', 'Writes are not granted for this session.', 403);
    }
    if (!userPath) deny('INVALID_PATH', 'path is required.');
    if (typeof content !== 'string') deny('INVALID_CONTENT', 'content must be a string.');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_WRITE_BYTES) {
      deny('TOO_LARGE', `Write exceeds ${MAX_WRITE_BYTES} bytes.`);
    }
    const abs = await resolveInRoot(userPath, { mustExist: false });
    await fs.writeFile(abs, content, { encoding: 'utf8' });
    return {
      ok: true,
      path: logicalPath(abs),
      bytes,
    };
  }

  function requireJobsGrant() {
    if (!jobsGranted) deny('JOBS_GRANT_REQUIRED', 'Print jobs are not granted for this session.', 403);
  }

  async function exportScad({ scad, output, defines } = {}) {
    requireJobsGrant();
    if (!openscadBin) deny('BIN_MISSING', 'OpenSCAD is not installed (or ATOM_OPENSCAD is unset).', 500);
    requireExtension(scad, '.scad');
    requireExtension(output, '.stl');
    const scadAbs = await resolveInRoot(scad, { mustExist: true });
    const outAbs = await resolveInRoot(output, { mustExist: false });
    await fs.mkdir(path.dirname(outAbs), { recursive: true });
    const defineFlags = serializeOpenScadDefines(defines);
    const argv = [];
    for (const def of defineFlags) {
      argv.push('-D', def);
    }
    argv.push('-o', outAbs, scadAbs);
    const result = await run(openscadBin, argv, {
      cwd: path.dirname(scadAbs),
      timeoutMs: OPENSCAD_TIMEOUT_MS,
    });
    if (result.code !== 0) {
      deny(
        'JOB_FAILED',
        `OpenSCAD exited ${result.code}. ${clipJobLog(result.stderr || result.stdout)}`.trim(),
        500,
      );
    }
    let bytes = 0;
    try {
      bytes = (await fs.stat(outAbs)).size;
    } catch {
      deny('JOB_FAILED', 'OpenSCAD finished but the STL was not written.', 500);
    }
    return {
      ok: true,
      scad: logicalPath(scadAbs),
      output: logicalPath(outAbs),
      bytes,
      log: clipJobLog(`${result.stdout}\n${result.stderr}`.trim()),
    };
  }

  async function slicePrint({ stl, name, fast, supports, start } = {}) {
    requireJobsGrant();
    if (start === true) {
      deny(
        'START_SEPARATE',
        'slice_print only stages (slice + upload). Call start_print after the operator confirms.',
        400,
      );
    }
    if (!pythonBin) deny('BIN_MISSING', 'python3 is not available (or ATOM_PYTHON is unset).', 500);
    let realScript;
    try {
      realScript = fsSync.realpathSync(slicePrintPath);
    } catch {
      deny('BIN_MISSING', 'slice_print.py was not found under Documents/3d_Printing/PRINTS.', 500);
    }
    const sliceRel = path.relative(resolvedRoot, realScript);
    if (sliceRel.startsWith('..') || path.isAbsolute(sliceRel)) {
      deny('OUTSIDE_ROOT', 'slice_print.py must live under Documents.');
    }
    requireExtension(stl, '.stl');
    const stlAbs = await resolveInRoot(stl, { mustExist: true });
    const jobName = requireJobName(name);
    const argv = [realScript, '--stl', stlAbs, '--name', jobName];
    if (fast === true) argv.push('--fast');
    if (supports === true) argv.push('--supports');
    const result = await run(pythonBin, argv, {
      cwd: path.dirname(realScript),
      timeoutMs: SLICE_TIMEOUT_MS,
    });
    const log = clipJobLog(`${result.stdout}\n${result.stderr}`.trim());
    if (result.code !== 0) {
      deny('JOB_FAILED', `slice_print.py exited ${result.code}. ${log}`.trim(), 500);
    }
    return {
      ok: true,
      stl: logicalPath(stlAbs),
      name: jobName,
      staged: true,
      start: false,
      log,
    };
  }

  async function startPrint({ name } = {}) {
    if (!startGranted) {
      deny('START_GRANT_REQUIRED', 'Starting a print requires a one-time operator confirm.', 403);
    }
    startGranted = false;
    if (!moonraker) deny('CONFIG', 'Moonraker URL is not configured.', 500);
    const jobName = requireJobName(name);
    const filename = `${jobName}.gcode`;
    const url = `${moonraker}/printer/print/start?filename=${encodeURIComponent(filename)}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), START_PRINT_TIMEOUT_MS);
    let body;
    try {
      const res = await doFetch(url, { method: 'POST', signal: ac.signal });
      const text = await res.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: clipJobLog(text) };
      }
      if (!res.ok) {
        deny('JOB_FAILED', `Moonraker start failed (${res.status}). ${clipJobLog(text)}`.trim(), 502);
      }
    } catch (err) {
      if (err instanceof DesktopHostError) throw err;
      deny('JOB_FAILED', err?.message || 'Moonraker start failed.', 502);
    } finally {
      clearTimeout(timer);
    }
    return {
      ok: true,
      name: jobName,
      filename,
      started: true,
      moonraker,
      result: body,
    };
  }


  async function shellTool({ command } = {}) {
    const cmd = typeof command === 'string' ? command.trim() : '';
    if (!cmd) deny('BAD_COMMAND', 'shell requires a command', 400);
    const ran = await run(process.env.SHELL || '/bin/bash', ['-lc', cmd], {
      cwd: process.env.HOME || '/home/mike',
      timeoutMs: 20000,
    });
    return {
      ok: ran.code === 0,
      exit_code: ran.code,
      stdout: ran.stdout,
      stderr: ran.stderr,
    };
  }

  async function invoke(name, args = {}) {
    switch (name) {
      case 'list_dir':
        return listDir(args);
      case 'read_file':
        return readFileTool(args);
      case 'write_file':
        return writeFileTool(args);
      case 'export_scad':
        return exportScad(args);
      case 'slice_print':
        return slicePrint(args);
      case 'start_print':
        return startPrint(args);
      case 'shell':
        return shellTool(args);
      default:
        deny('UNKNOWN_TOOL', `Unknown tool: ${name}`, 400);
    }
  }

  return {
    status,
    grantWrites,
    revokeWrites,
    grantJobs,
    revokeJobs,
    grantStart,
    revokeStart,
    invoke,
    resolveInRoot,
    get root() {
      return resolvedRoot;
    },
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new DesktopHostError('BODY_TOO_LARGE', 'Request body too large.', 413));
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
        reject(new DesktopHostError('INVALID_JSON', 'Invalid JSON.', 400));
      }
    });
    req.on('error', reject);
  });
}

export function stripDesktopHostPrefix(urlPath) {
  const pathname = (urlPath || '').split('?')[0];
  if (pathname.startsWith('/api/desktop-host')) {
    const rest = pathname.slice('/api/desktop-host'.length);
    return rest || '/';
  }
  return pathname || '/';
}

/**
 * Connect-style middleware. Returns true if the request was handled.
 */
export async function handleDesktopHostRequest(host, req, res, next) {
  const pathname = (req.url || '').split('?')[0];
  if (!pathname.startsWith('/api/desktop-host')) {
    next?.();
    return false;
  }

  if (!isLocalAddress(req.socket?.remoteAddress)) {
    sendJson(res, 403, { ok: false, code: 'LOCAL_ONLY', error: 'Desktop host is only available from this machine.' });
    return true;
  }

  const route = stripDesktopHostPrefix(pathname);
  const method = req.method || 'GET';

  try {
    if (route === '/' || route === '/status') {
      if (method === 'GET' || method === 'HEAD') {
        sendJson(res, 200, host.status());
        return true;
      }
    }
    if (route === '/grant-writes' && method === 'POST') {
      sendJson(res, 200, host.grantWrites());
      return true;
    }
    if (route === '/revoke-writes' && method === 'POST') {
      sendJson(res, 200, host.revokeWrites());
      return true;
    }
    if (route === '/grant-jobs' && method === 'POST') {
      sendJson(res, 200, host.grantJobs());
      return true;
    }
    if (route === '/revoke-jobs' && method === 'POST') {
      sendJson(res, 200, host.revokeJobs());
      return true;
    }
    if (route === '/grant-start' && method === 'POST') {
      sendJson(res, 200, host.grantStart());
      return true;
    }
    if (route === '/revoke-start' && method === 'POST') {
      sendJson(res, 200, host.revokeStart());
      return true;
    }
    if (route === '/invoke' && method === 'POST') {
      const body = await readJsonBody(req);
      const name = body?.name;
      const args = body?.arguments && typeof body.arguments === 'object' ? body.arguments : {};
      const result = await host.invoke(name, args);
      sendJson(res, 200, result);
      return true;
    }
    sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: 'Unknown desktop-host route.' });
    return true;
  } catch (err) {
    if (err instanceof DesktopHostError) {
      sendJson(res, err.status, { ok: false, code: err.code, error: err.message });
      return true;
    }
    sendJson(res, 500, { ok: false, code: 'INTERNAL', error: err?.message || 'Desktop host failed.' });
    return true;
  }
}
