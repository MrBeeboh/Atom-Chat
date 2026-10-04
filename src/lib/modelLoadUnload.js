/**
 * Local model load/unload management across the llama.cpp router, LM Studio REST,
 * and single-model llama-server. Extracted from api.js.
 */
import { getLmStudioBase, getUnloadHelperUrl } from '$lib/apiConfig.js';
import {
  probeLlamaRouterModelsList,
  getLoadedIdsFromRouterData,
  isRouterModelFullyLoaded,
  findRouterModelRow,
  getRouterModelStatusValue,
  isRouterModelLoadFailed,
  modelIdsLooselyMatch,
} from '$lib/llamaRouter.js';
import { getLocalModelsFromServer, probeLmsRestModelsList } from '$lib/modelListing.js';
import { isQwen38FlashNextSelection } from '$lib/modelIdUtils.js';
import { FLASH_NEXT_CHAT_BASE, assertFlashNextCanChat } from '$lib/flashNext.js';

/**
 * Get model keys that are currently loaded in VRAM.
 * llama.cpp router: GET /models. LM Studio: GET /api/v1/models + loaded_instances.
 * @returns {Promise<string[]>}
 */
export async function getLoadedModelKeys() {
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    if (await probeLlamaRouterModelsList()) {
      const res = await fetch(`${base}/models`, { signal: ctrl.signal });
      if (!res.ok) return [];
      const data = await res.json();
      return getLoadedIdsFromRouterData(data);
    }
    const res = await fetch(`${base}/api/v1/models`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = data.models ?? data.data?.models ?? (Array.isArray(data) ? data : []);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((m) => {
        const instances = m?.loaded_instances ?? m?.instances ?? m?.loaded;
        return m && Array.isArray(instances) && instances.length > 0;
      })
      .map((m) => m.key ?? m.id ?? '')
      .filter(Boolean);
  } catch (_) {
    return [];
  } finally {
    clearTimeout(to);
  }
}

/**
 * Unload one model instance by instance_id (LM Studio REST: POST body is { instance_id }).
 * @param {string} instanceId - From loaded_instances[].id in list response
 * @returns {Promise<{ instance_id?: string }>}
 */
export async function unloadByInstanceId(instanceId) {
  if (!instanceId || typeof instanceId !== 'string') return {};
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/api/v1/models/unload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_id: instanceId }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LM Studio unload: ${res.status} ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(to);
  }
}

/**
 * Wait until none of the given model IDs are loaded (VRAM freed). Polls getLoadedModelKeys.
 * @param {string[]} modelIds - Model keys to wait until unloaded
 * @param {Object} opts - { pollIntervalMs?: number, timeoutMs?: number }
 * @returns {Promise<void>}
 */
export async function waitUntilUnloaded(modelIds, opts = {}) {
  const { pollIntervalMs = 400, timeoutMs = 25000 } = opts;
  if (!modelIds.length) return;
  const ids = modelIds.map((id) => String(id).trim()).filter(Boolean);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const loaded = await getLoadedModelKeys();
    const anyStillLoaded = ids.some((id) => loaded.some((k) => modelIdsLooselyMatch(k, id)));
    if (!anyStillLoaded) return;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * True when this local id is already chat-ready (alias / path / basename).
 * Cloud ids are never "local ready".
 * @param {string} modelId
 * @returns {Promise<boolean>}
 */
export async function isLocalModelChatReady(modelId) {
  if (!modelId || typeof modelId !== 'string' || modelId.includes(':')) return false;
  if (isQwen38FlashNextSelection(modelId)) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/health`, { signal: ctrl.signal });
        return res.ok;
      } finally {
        clearTimeout(to);
      }
    } catch {
      return false;
    }
  }
  const base = getLmStudioBase();
  try {
    if (await probeLlamaRouterModelsList()) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(`${base}/models`, { signal: ctrl.signal });
        if (!res.ok) return false;
        return isRouterModelFullyLoaded(await res.json(), modelId);
      } finally {
        clearTimeout(to);
      }
    }
    const loaded = await getLoadedModelKeys();
    return loaded.some((k) => modelIdsLooselyMatch(k, modelId));
  } catch {
    return false;
  }
}

/**
 * Cockpit/chat: if the router child is already up, skip. Otherwise POST /models/load
 * (which LRU-evicts when --models-max is hit) and wait until chat-ready.
 * Chat requests also pass ?autoload=true so a missed preload still swaps in-request.
 * Cloud ids (provider:model) are no-ops.
 * @param {string} modelId
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export async function ensureLocalModelReadyForChat(modelId, signal) {
  if (!modelId || typeof modelId !== 'string' || modelId.includes(':')) return;
  if (isQwen38FlashNextSelection(modelId)) {
    await assertFlashNextCanChat();
    return;
  }
  if (!(await probeLlamaRouterModelsList())) return;
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
  if (await isLocalModelChatReady(modelId)) return;
  await loadModel(modelId);
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
  const ready = await waitUntilLoaded(modelId, {
    pollIntervalMs: 500,
    timeoutMs: 600000,
  });
  if (!ready) {
    throw new Error(
      `Model failed to load: "${modelId}" did not become ready (bad GGUF, VRAM, or llama-server). Check llama-server.log.`,
    );
  }
}

/**
 * Wait until router status.value === "loaded" (chat-ready).
 * POST /models/load returns success as soon as the child is spawned — chat before ready fails.
 * @param {string} modelId
 * @param {Object} [opts]
 * @returns {Promise<boolean>}
 */
export async function waitUntilLoaded(modelId, opts = {}) {
  const { pollIntervalMs = 400, timeoutMs = 600000 } = opts;
  if (!modelId || typeof modelId !== 'string' || !modelId.trim()) return false;
  if (isQwen38FlashNextSelection(modelId)) return true;
  const base = getLmStudioBase();
  const start = Date.now();
  let sawLoading = false;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await probeLlamaRouterModelsList()) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(`${base}/models`, { signal: ctrl.signal });
          if (res.ok) {
            const data = await res.json();
            if (isRouterModelFullyLoaded(data, modelId)) return true;
            const row = findRouterModelRow(data, modelId);
            const st = row ? getRouterModelStatusValue(row) : '';
            if (st === 'loading') sawLoading = true;
            if (isRouterModelLoadFailed(data, modelId) || (sawLoading && st === 'unloaded')) {
              throw new Error(
                `Model failed to load: "${modelId}" (llama child exited). This GGUF may be incompatible. Check llama-server.log.`,
              );
            }
          }
        } finally {
          clearTimeout(to);
        }
      } else {
        const loaded = await getLoadedModelKeys();
        if (loaded.some((k) => modelIdsLooselyMatch(k, modelId))) return true;
      }
    } catch (e) {
      if (e && /failed to load/i.test(String(e.message || e))) throw e;
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return false;
}

/**
 * Load a model: llama.cpp router uses POST /models/load; LM Studio uses POST /api/v1/models/load.
 * @param {string} modelId - Model identifier (as in GET /v1/models or GET /models)
 * @param {Object} loadConfig
 * @param {number} [loadConfig.context_length]
 * @param {number} [loadConfig.eval_batch_size]
 * @param {boolean} [loadConfig.flash_attention]
 * @param {boolean} [loadConfig.offload_kv_cache_to_gpu]
 * @returns {Promise<object>}
 */
export async function loadModel(modelId, loadConfig = {}) {
  if (!modelId || typeof modelId !== 'string' || !modelId.trim()) {
    throw new Error('loadModel: model id required');
  }
  if (isQwen38FlashNextSelection(modelId)) {
    return { success: true, alreadyRunning: true };
  }
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 180000);
  try {
    if (await probeLlamaRouterModelsList()) {
      const id = modelId.trim();
      // Already chat-ready — do not call /models/load (returns 400 "already running").
      try {
        const probe = await fetch(`${base}/models`, { signal: ctrl.signal });
        if (probe.ok) {
          const data = await probe.json();
          if (isRouterModelFullyLoaded(data, id)) {
            return { success: true, alreadyRunning: true };
          }
        }
      } catch (_) {
        /* fall through to load */
      }
      const postLoad = () =>
        fetch(`${base}/models/load`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: id }),
          signal: ctrl.signal,
        });
      let res = await postLoad();
      if (!res.ok) {
        let text = await res.text();
        // Idempotent: concurrent Arena prep / double-click often hits this.
        if (
          res.status === 400 &&
          /already running|already loaded|already in use/i.test(text)
        ) {
          return { success: true, alreadyRunning: true };
        }
        // Slot full: unload occupants (except this id) and retry once.
        // POST /models/load already LRU-evicts; this covers the race / older binaries.
        if (res.status === 400 && /limit reached|try again later|too many models/i.test(text)) {
          const occupants = await getLoadedModelKeys();
          for (const occ of occupants) {
            if (!modelIdsLooselyMatch(occ, id)) await unloadModel(occ);
          }
          res = await postLoad();
          if (res.ok) return res.json().catch(() => ({}));
          text = await res.text();
          if (
            res.status === 400 &&
            /already running|already loaded|already in use/i.test(text)
          ) {
            return { success: true, alreadyRunning: true };
          }
        }
        throw new Error(`llama-server load: ${res.status} ${text}`);
      }
      return res.json().catch(() => ({}));
    }
    if (!(await probeLmsRestModelsList())) {
      // Classic single-model llama-server (one GGUF chosen at process start, e.g. Flash-Next on :8081).
      // The served model is already resident, so "load" is a no-op instead of a false failure.
      const served = (await getLocalModelsFromServer()).map((m) => m.id);
      if (served.some((id) => modelIdsLooselyMatch(id, modelId))) {
        return { success: true, alreadyRunning: true, singleModelServer: true };
      }
      throw new Error(
        served.length
          ? `This server hosts a single fixed model (${served.join(', ')}) and cannot load "${modelId}". Pick the served model or switch the backend URL.`
          : 'This backend has no model-load API. Use llama.cpp server with router mode (Atom launcher) or LM Studio.',
      );
    }
    const body = { model: modelId };
    if (loadConfig.context_length != null && Number(loadConfig.context_length) > 0) {
      body.context_length = loadConfig.context_length;
    }
    if (loadConfig.eval_batch_size != null) body.eval_batch_size = loadConfig.eval_batch_size;
    if (loadConfig.flash_attention != null) body.flash_attention = loadConfig.flash_attention;
    if (loadConfig.offload_kv_cache_to_gpu != null) body.offload_kv_cache_to_gpu = loadConfig.offload_kv_cache_to_gpu;
    body.echo_load_config = true;
    const res = await fetch(`${base}/api/v1/models/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LM Studio load: ${res.status} ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(to);
  }
}

/**
 * Get loaded instance IDs for a single model key (from GET /api/v1/models: model.key + loaded_instances[].id).
 * @param {string} modelKey - Model key to match (m.key ?? m.id)
 * @returns {Promise<string[]>}
 */
export async function getLoadedInstanceIdsForModel(modelKey) {
  if (!modelKey || typeof modelKey !== 'string') return [];
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/api/v1/models`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = data.models ?? data.data?.models ?? (Array.isArray(data) ? data : []);
    const key = String(modelKey).trim().toLowerCase();
    const ids = [];
    for (const m of raw) {
      const modelKeyCur = (m?.key ?? m?.id ?? '').toString().trim().toLowerCase();
      if (!modelKeyCur || modelKeyCur !== key && !modelKeyCur.endsWith('/' + key) && !key.endsWith('/' + modelKeyCur))
        continue;
      const instances = m?.loaded_instances ?? m?.instances;
      if (Array.isArray(instances)) for (const inst of instances) if (inst?.id != null) ids.push(String(inst.id));
    }
    return ids;
  } catch (_) {
    return [];
  } finally {
    clearTimeout(to);
  }
}

/**
 * Unload a model from memory: llama.cpp router POST /models/unload; LM Studio uses instance ids.
 * @param {string} modelId - Model key (e.g. from load or list)
 * @returns {Promise<void>}
 */
export async function unloadModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return;
  const base = getLmStudioBase();
  if (await probeLlamaRouterModelsList()) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 120000);
    try {
      await fetch(`${base}/models/unload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId.trim() }),
        signal: ctrl.signal,
      });
    } catch (_) {
      /* ignore */
    } finally {
      clearTimeout(to);
    }
    return;
  }
  const instanceIds = await getLoadedInstanceIdsForModel(modelId);
  await Promise.allSettled(instanceIds.map((id) => unloadByInstanceId(id).catch(() => { })));
}

const DEFAULT_UNLOAD_HELPER_URL = 'http://localhost:8766';

/**
 * Unload every currently loaded model instance (e.g. before Arena run to free VRAM).
 * Calls the helper at helperUrlOrOverride, or from localStorage, or default http://localhost:8766.
 * If the helper is not running, returns { ok: false } and does not throw — so Arena run is never blocked.
 * @param {string} [helperUrlOrOverride] - Optional; if set, use this; else localStorage; else default.
 * @returns {Promise<{ ok: boolean }>} - ok true if eject succeeded, false if helper unreachable or error.
 */
export async function unloadAllLoadedModels(helperUrlOrOverride) {
  const fromOverride =
    typeof helperUrlOrOverride === 'string' && helperUrlOrOverride.trim()
      ? helperUrlOrOverride.trim().replace(/\/$/, '')
      : '';
  const helperUrl = fromOverride || getUnloadHelperUrl() || DEFAULT_UNLOAD_HELPER_URL;

  try {
    const res = await fetch(`${helperUrl}/unload-all`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) return { ok: true };
    return { ok: false };
  } catch (_) {
    return { ok: false };
  }
}

/**
 * Unload every loaded model: llama.cpp router POST /models/unload per id; LM Studio uses instance unload.
 * @returns {Promise<{ ok: boolean, unloaded: number }>}
 */
export async function unloadAllModelsNative() {
  try {
    const base = getLmStudioBase();
    if (await probeLlamaRouterModelsList()) {
      const loaded = await getLoadedModelKeys();
      let unloaded = 0;
      for (const id of loaded) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 120000);
        try {
          const res = await fetch(`${base}/models/unload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: id }),
            signal: ctrl.signal,
          });
          if (res.ok) unloaded += 1;
        } catch (_) {
          /* continue */
        } finally {
          clearTimeout(to);
        }
      }
      return { ok: true, unloaded };
    }
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetch(`${base}/api/v1/models`, { signal: ctrl.signal });
    } finally {
      clearTimeout(to);
    }
    if (!res.ok) return { ok: false, unloaded: 0 };
    const data = await res.json();
    const raw = data.models ?? data.data?.models ?? (Array.isArray(data) ? data : []);
    if (!Array.isArray(raw)) return { ok: false, unloaded: 0 };
    const instanceIds = [];
    for (const m of raw) {
      const instances = m?.loaded_instances ?? m?.instances;
      if (Array.isArray(instances)) {
        for (const inst of instances) {
          if (inst?.id != null) instanceIds.push(String(inst.id));
        }
      }
    }
    if (instanceIds.length === 0) return { ok: true, unloaded: 0 };
    await Promise.allSettled(instanceIds.map((id) => unloadByInstanceId(id).catch(() => { })));
    return { ok: true, unloaded: instanceIds.length };
  } catch (_) {
    return { ok: false, unloaded: 0 };
  }
}
