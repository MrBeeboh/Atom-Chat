/**
 * Local + cloud model discovery: server list, disk inventory, backend probes, and
 * effective local model-id resolution. Extracted from api.js.
 */
import { getLmStudioBase, LOCAL_MODELS_TIMEOUT_MS } from '$lib/apiConfig.js';
import { apiState } from '$lib/apiState.js';
import {
  isLlamaRouterModelsPayload,
  parseLlamaRouterModelsList,
  probeLlamaRouterModelsList,
} from '$lib/llamaRouter.js';
import { mergeUniqueModelItems, mergeServerAndDiskModels, ggufBasenameLower, QWEN38_FLASH_NEXT_MODEL_ID, isQwen38FlashNextSelection } from '$lib/modelIdUtils.js';
import { attachFlashNextLiveCaps } from '$lib/flashNext.js';
import { fetchCloudModels } from '$lib/cloudCatalog.js';

function extraLocalModelDirsFromStorage() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = (localStorage.getItem('localModelDirs') ?? '').trim();
    if (!raw) return [];
    return raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s));
  } catch {
    return [];
  }
}

/** Dev: list .gguf paths from LM Studio, ~/models, llama.cpp cache, Downloads, and extra folders. */
async function fetchDiskModelInventory() {
  if (!import.meta.env.DEV) return [];
  const extra = extraLocalModelDirsFromStorage();
  const q = extra.length ? `?extra=${encodeURIComponent(extra.join('\n'))}` : '';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`/api/atom-local-disk-models${q}`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = data.models ?? data;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((m) => (typeof m?.id === 'string' ? { id: m.id.trim() } : null))
      .filter((m) => m && m.id);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** Return cloud provider models when API key is set. Ids are "provider:modelId". */
async function getCloudModels() {
  try {
    return await fetchCloudModels();
  } catch {
    return [];
  }
}

/** Flash-Next is proxied on :8080; keep its id in the chat list even if a stale proxy omits it. */
function ensureFlashNextListed(items) {
  if (!Array.isArray(items)) return items;
  if (items.some((m) => isQwen38FlashNextSelection(m?.id))) return items;
  return [...items, { id: QWEN38_FLASH_NEXT_MODEL_ID }];
}

/**
 * Models reported by the inference server (LM Studio REST, llama-server /v1/models, etc.).
 * @returns {Promise<{ id: string }[]>}
 */
export async function getLocalModelsFromServer() {
  const base = getLmStudioBase();
  const rest = `${base}/api/v1`;
  const openai = `${base}/v1`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), LOCAL_MODELS_TIMEOUT_MS);
  try {
    const routerRes = await fetch(`${base}/models`, { signal: ctrl.signal });
    if (routerRes.ok) {
      const ct = routerRes.headers.get('content-type') || '';
      if (/json/i.test(ct)) {
        const data = await routerRes.json();
        apiState.llamaRouterModelsSupported = isLlamaRouterModelsPayload(data);
        const fromRouter = parseLlamaRouterModelsList(data);
        if (fromRouter.length > 0) return fromRouter;
      }
    }
    const fallback = await fetch(`${openai}/models`, { signal: ctrl.signal });
    if (!fallback.ok) {
      const restRes = await fetch(`${rest}/models`, { signal: ctrl.signal });
      if (!restRes.ok) return [];
      const data = await restRes.json();
      const rawModels = Array.isArray(data.models) ? data.models : [];
      const rawData = Array.isArray(data.data) ? data.data : [];
      const rawTop = Array.isArray(data) ? data : [];
      const combined = [...rawModels, ...rawData, ...(rawModels.length || rawData.length ? [] : rawTop)];
      return mergeUniqueModelItems(combined.filter((m) => m && m.type !== 'embedding'));
    }
    const data = await fallback.json();
    const fromData = Array.isArray(data.data) ? data.data : [];
    const fromModels = Array.isArray(data.models) ? data.models : [];
    const rawArr = Array.isArray(data) && !fromData.length && !fromModels.length ? data : [];
    return mergeUniqueModelItems([
      ...fromData.filter((m) => m && m.type !== 'embedding'),
      ...fromModels.filter((m) => m && m.type !== 'embedding'),
      ...rawArr.filter((m) => m && m.type !== 'embedding'),
    ]);
  } catch {
    return [];
  } finally {
    clearTimeout(to);
  }
}

/**
 * Local models for chat/Arena.
 * When llama.cpp router is up, return **only** router-loadable ids (GET /models).
 * Merging disk paths caused 404s: UI showed Hermes / nested LM Studio paths that
 * --models-dir cannot load (router only indexes top-level .gguf + immediate subdirs).
 * Disk inventory is used only when the server list is empty (offline / first boot).
 * @returns {Promise<{ id: string }[]>}
 */
async function getLocalModels() {
  const fromServer = await attachFlashNextLiveCaps(
    ensureFlashNextListed(await getLocalModelsFromServer()),
  );
  // getLocalModelsFromServer sets llamaRouterModelsSupported when GET /models works.
  if (fromServer.length > 0 && apiState.llamaRouterModelsSupported === true) {
    apiState.lastLocalModelIds = fromServer.map((x) => x.id);
    return fromServer;
  }
  const fromDisk = await fetchDiskModelInventory();
  const merged = ensureFlashNextListed(mergeServerAndDiskModels(fromServer, fromDisk));
  apiState.lastLocalModelIds = merged.map((x) => x.id);
  return merged;
}

/**
 * True when the backend exposes LM Studio–style GET /api/v1/models (load/unload management).
 * llama-server (OpenAI route only) returns 404 — Arena should not rely on swapping models via REST.
 */
export async function probeLmsRestModelsList() {
  if (apiState.lmsRestModelsListSupported !== null) return apiState.lmsRestModelsListSupported;
  if (apiState.llamaRouterModelsSupported === true) {
    apiState.lmsRestModelsListSupported = false;
    return false;
  }
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${base}/api/v1/models`, { method: 'GET', signal: ctrl.signal });
    apiState.lmsRestModelsListSupported = res.ok;
    return apiState.lmsRestModelsListSupported;
  } catch {
    apiState.lmsRestModelsListSupported = false;
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * llama-server (classic): one GGUF at process start. Router mode: many ids from GET /models; chat uses the selected id.
 * When REST management is absent and exactly one local model is listed, map any local request to it so legacy Arena works.
 */
export async function resolveEffectiveLocalChatModelId(modelId) {
  if (!modelId || typeof modelId !== 'string' || modelId.includes(':')) return modelId;
  if (await probeLlamaRouterModelsList()) return modelId;
  const lms = await probeLmsRestModelsList();
  if (lms) return modelId;
  let ids = apiState.lastLocalModelIds;
  if (ids.length === 0) {
    try {
      ids = (await getLocalModels()).map((m) => m.id);
    } catch {
      return modelId;
    }
  }
  if (ids.length === 1) return ids[0];
  const selBase = ggufBasenameLower(modelId);
  if (selBase) {
    const serverOnly = ids.filter((id) => !id.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(id));
    if (serverOnly.length === 1 && ggufBasenameLower(serverOnly[0]) === selBase) return serverOnly[0];
  }
  return modelId;
}

/**
 * Fetch list of models: local inference server + disk GGUFs + live cloud catalogs.
 * If the local server is unreachable, still returns cloud models when API keys are set.
 * @returns {Promise<{ id: string }[]>}
 */
export async function getModels() {
  const [local, cloud] = await Promise.all([
    getLocalModels().catch(() => []),
    getCloudModels(),
  ]);
  return [...local, ...cloud];
}
