/**
 * llama.cpp router helpers: GET /models payload parsing, status detection, and the
 * backend probes (router? REST? reachable?). Extracted from api.js.
 */
import { mergeUniqueModelItems } from '$lib/modelIdUtils.js';
import { endpointCapsFromRow } from '$lib/modelCapabilities.js';
import { getLmStudioBase } from '$lib/apiConfig.js';
import { apiState } from '$lib/apiState.js';

/** llama.cpp router: GET /models response shapes (experimental). */
export function extractRouterModelRows(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.models)) return data.models;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

/**
 * True when a GET /models payload comes from a llama.cpp **router** (many models, load/unload API).
 * Router rows always carry a `status` ("loaded" | "unloaded" | ...). A plain single-model
 * `llama-server` (e.g. the Flash-Next Docker server on :8081) also answers GET /models with 200 JSON
 * but its rows have no `status` and it has no POST /models/load, so treating it as a router made
 * Atom Chat try to "load" the model, get a 404, and report that the model would not load.
 * An empty list cannot be told apart, so it keeps the old "assume router" behavior.
 * @param {unknown} data
 * @returns {boolean}
 */
export function isLlamaRouterModelsPayload(data) {
  const rows = extractRouterModelRows(data);
  if (rows.length === 0) return true;
  return rows.some((m) => getRouterModelStatusValue(m) !== '');
}

export function parseLlamaRouterModelsList(data) {
  const rows = extractRouterModelRows(data);
  const items = [];
  for (const m of rows) {
    const id = m?.id ?? m?.name ?? m?.model ?? m?.path;
    if (typeof id !== 'string' || !id.trim()) continue;
    const caps = endpointCapsFromRow(m);
    items.push(caps ? { id: id.trim(), caps } : { id: id.trim() });
  }
  return mergeUniqueModelItems(items);
}

/**
 * llama.cpp router reports status as a string OR `{ value: "loaded"|"loading"|"unloaded" }`.
 * `String({value:"loaded"})` becomes `"[object Object]"` — never matches — so loaded detection broke.
 * @param {object} m
 * @returns {string}
 */
export function getRouterModelStatusValue(m) {
  if (!m || typeof m !== 'object') return '';
  if (typeof m.state === 'string') return m.state.toLowerCase().trim();
  if (typeof m.status === 'string') return m.status.toLowerCase().trim();
  if (m.status && typeof m.status === 'object' && m.status.value != null) {
    return String(m.status.value).toLowerCase().trim();
  }
  return '';
}

/** Loose match for router alias vs path vs basename. */
export function modelIdsLooselyMatch(a, b) {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.endsWith('/' + y) || y.endsWith('/' + x)) return true;
  const base = (s) => {
    const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    const leaf = slash >= 0 ? s.slice(slash + 1) : s;
    return leaf.replace(/\.gguf$/i, '');
  };
  const bx = base(x);
  const by = base(y);
  return !!(bx && by && (bx === by || bx.includes(by) || by.includes(bx)));
}

export function getLoadedIdsFromRouterData(data) {
  const rows = extractRouterModelRows(data);
  const out = [];
  for (const m of rows) {
    const id = m?.id ?? m?.name ?? m?.model ?? m?.path;
    if (typeof id !== 'string' || !id.trim()) continue;
    const st = getRouterModelStatusValue(m);
    // "loading" occupies the models-max 1 slot — count it for unload waits.
    if (
      st === 'loaded' ||
      st === 'loading' ||
      st === 'ready' ||
      m?.loaded === true ||
      m?.is_active === true ||
      m?.active === true
    ) {
      out.push(id.trim());
    }
  }
  return out;
}

export function findRouterModelRow(data, modelId) {
  const rows = extractRouterModelRows(data);
  for (const m of rows) {
    const id = m?.id ?? m?.name ?? m?.model ?? m?.path;
    if (typeof id === 'string' && id.trim() && modelIdsLooselyMatch(id, modelId)) return m;
  }
  return null;
}

/** True when router reports this model as fully chat-ready (not merely loading). */
export function isRouterModelFullyLoaded(data, modelId) {
  const m = findRouterModelRow(data, modelId);
  if (!m) return false;
  const st = getRouterModelStatusValue(m);
  const statusObj = m.status && typeof m.status === 'object' ? m.status : {};
  if (statusObj.failed === true) return false;
  return st === 'loaded' || st === 'ready' || m?.loaded === true || m?.is_active === true || m?.active === true;
}

/** Child spawn died (bad GGUF / missing tensors). Do not wait 10 minutes. */
export function isRouterModelLoadFailed(data, modelId) {
  const m = findRouterModelRow(data, modelId);
  if (!m) return false;
  const statusObj = m.status && typeof m.status === 'object' ? m.status : {};
  if (statusObj.failed === true) return true;
  if (statusObj.exit_code != null && Number(statusObj.exit_code) !== 0) {
    const st = getRouterModelStatusValue(m);
    if (st === 'unloaded' || st === 'failed') return true;
  }
  return false;
}

export async function probeLlamaRouterModelsList() {
  if (apiState.llamaRouterModelsSupported !== null) return apiState.llamaRouterModelsSupported;
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${base}/models`, { method: 'GET', signal: ctrl.signal });
    if (res.status === 404) {
      apiState.llamaRouterModelsSupported = false;
      return false;
    }
    if (!res.ok) {
      return false;
    }
    const ct = res.headers.get('content-type') || '';
    if (!/json/i.test(ct)) {
      apiState.llamaRouterModelsSupported = false;
      return false;
    }
    const payload = await res.json();
    apiState.llamaRouterModelsSupported = isLlamaRouterModelsPayload(payload);
    return apiState.llamaRouterModelsSupported;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Live llama.cpp n_ctx (ATOM's server is --ctx-size 65536). Falls back to 65536
 * when /props is missing so we never send a 262k cloud thread at a local model.
 * @returns {Promise<number>}
 */
export async function probeLocalContextSize() {
  const now = Date.now();
  if (apiState.cachedLocalNCtx.value > 0 && now - apiState.cachedLocalNCtx.at < 30_000) {
    return apiState.cachedLocalNCtx.value;
  }
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  const remember = (n) => {
    apiState.cachedLocalNCtx = { at: now, value: n };
    return n;
  };
  try {
    const res = await fetch(`${base}/v1/models`, { signal: ctrl.signal });
    if (res.ok) {
      const data = await res.json();
      for (const m of data?.data || []) {
        const loaded = Number(m?.meta?.n_ctx || 0);
        if (Number.isFinite(loaded) && loaded > 0) return remember(loaded);
        const args = m?.status?.args;
        if (Array.isArray(args)) {
          const i = args.indexOf('--ctx-size');
          if (i >= 0) {
            const n = Number(args[i + 1]);
            if (Number.isFinite(n) && n > 0) return remember(n);
          }
        }
      }
    }
  } catch {
    /* use default */
  } finally {
    clearTimeout(t);
  }
  return 65536;
}

/**
 * Check if LM Studio is reachable (lightweight health check).
 * @returns {Promise<boolean>}
 */
export async function checkLmStudioConnection() {
  const base = getLmStudioBase();
  const tryFetch = async (url) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(to);
    }
  };
  try {
    if (await tryFetch(`${base}/models`)) return true;
  } catch (_) { }
  try {
    if (await tryFetch(`${base}/v1/models`)) return true;
  } catch (_) { }
  try {
    return await tryFetch(`${base}/api/v1/models`);
  } catch {
    return false;
  }
}
