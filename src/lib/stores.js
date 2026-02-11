/**
 * @file stores.js
 * @description Central Svelte stores and derived state for the app: conversations, models, settings,
 * UI state, and persisted preferences (layout, theme, LM Studio URL, per-model overrides, etc.).
 * Settings resolution: DEFAULT_SETTINGS ← globalDefault ← getRecommendedSettingsForModel ← perModelOverrides.
 */
import { writable, derived, get } from 'svelte/store';
import { detectHardware } from '$lib/hardware.js';
import { getRecommendedSettingsForModel } from '$lib/modelDefaults.js';

/** Currently selected conversation id or null */
export const activeConversationId = writable(null);

/** List of conversations for sidebar */
export const conversations = writable([]);

/** Messages for the active conversation (reactive) */
export const activeMessages = writable([]);

/** When set, ChatInput processes these files (drop anywhere in chat) then clears. */
export const pendingDroppedFiles = writable(null);

/** Loaded LM Studio model list { id }[] */
export const models = writable([]);

/** Hardware detected on startup (CPU logical cores; GPU not available from browser). */
export const hardware = writable(
  typeof navigator !== 'undefined' ? detectHardware() : { cpuLogicalCores: 4 }
);

/** Selected model id (persisted to localStorage as 'selectedModel') */
const getStoredSelectedModel = () =>
  (typeof localStorage !== 'undefined' ? localStorage.getItem('selectedModel') : null) || '';
export const selectedModelId = writable(getStoredSelectedModel());
if (typeof localStorage !== 'undefined') {
  selectedModelId.subscribe((v) => {
    if (v) localStorage.setItem('selectedModel', v);
  });
}

/** Brief message when previous model was unavailable and we fell back (e.g. "Previous model unavailable, selected X") */
export const modelSelectionNotification = writable(null);

/** UI: sidebar open on mobile */
export const sidebarOpen = writable(false);

/** UI: settings panel open */
export const settingsOpen = writable(false);

/** LM Studio connection status: true = reachable, false = not reachable, null = unknown */
export const lmStudioConnected = writable(null);

/** UI: keyboard shortcuts help modal open */
export const shortcutsModalOpen = writable(false);

/** Confirm modal: { title, message, confirmLabel, cancelLabel, danger, resolve } or null */
export const confirmStore = writable(null);
/** Show confirmation modal; returns Promise<boolean> */
export function confirm(options) {
  return new Promise((resolve) => {
    confirmStore.set({
      title: options.title ?? 'Confirm',
      message: options.message ?? '',
      confirmLabel: options.confirmLabel ?? 'Confirm',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      danger: options.danger ?? false,
      resolve,
    });
  });
}

/** UI: sidebar collapsed to narrow strip on desktop (Arena layout). Persisted. */
export const sidebarCollapsed = writable(
  typeof localStorage !== 'undefined' && localStorage.getItem('sidebarCollapsed') === 'true'
);

/** Cockpit layout: right Intel panel open (toggle with ]). */
export const cockpitIntelOpen = writable(true);

/** Workbench layout: pinned assistant message (markdown string or null). */
export const pinnedContent = writable(null);


/** Color scheme: default (red) | newsprint | neural | quantum | ... (see themeOptions.js) */
function getInitialUiTheme() {
  if (typeof localStorage === 'undefined') return 'default';
  const raw = localStorage.getItem('uiTheme') || 'default';
  if (raw === 'cyberpunk') {
    localStorage.setItem('uiTheme', 'default');
    return 'default';
  }
  return raw;
}
export const uiTheme = writable(getInitialUiTheme());

/** LM Studio server base URL (e.g. http://localhost:1234 or http://10.0.0.51:1234). Empty = use default. */
const getStoredLmStudioUrl = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('lmStudioBaseUrl') : null) || '';
export const lmStudioBaseUrl = writable(getStoredLmStudioUrl());
if (typeof localStorage !== 'undefined') {
  lmStudioBaseUrl.subscribe((v) => localStorage.setItem('lmStudioBaseUrl', v ?? ''));
}

/** Voice-to-text server URL (e.g. http://localhost:8765). Empty = voice mic disabled. */
const getStoredVoiceServerUrl = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('voiceServerUrl') : null) ?? 'http://localhost:8765';
export const voiceServerUrl = writable(getStoredVoiceServerUrl());
if (typeof localStorage !== 'undefined') {
  voiceServerUrl.subscribe((v) => localStorage.setItem('voiceServerUrl', v ?? ''));
}

/** Unload helper URL (Python SDK server at e.g. http://localhost:8766). When set, eject uses POST /unload-all. */
const getStoredUnloadHelperUrl = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('lmStudioUnloadHelperUrl') : null) || '';
export const lmStudioUnloadHelperUrl = writable(getStoredUnloadHelperUrl());
if (typeof localStorage !== 'undefined') {
  lmStudioUnloadHelperUrl.subscribe((v) => localStorage.setItem('lmStudioUnloadHelperUrl', v ?? ''));
}

/** Layout: cockpit | arena only (restore point). Old layouts migrate to cockpit. */
const OLD_TO_NEW_LAYOUT = {
  default: 'cockpit',
  flow: 'cockpit',
  splitbrain: 'cockpit',
  commandcenter: 'cockpit',
  floatingpalette: 'cockpit',
  minimal: 'cockpit',
  focus: 'cockpit',
  workbench: 'cockpit',
  dashboard: 'arena',
  nexus: 'cockpit',
};
function getInitialLayout() {
  if (typeof localStorage === 'undefined') return 'cockpit';
  const raw = localStorage.getItem('layout') || 'cockpit';
  const valid = ['cockpit', 'arena'];
  const migrated = OLD_TO_NEW_LAYOUT[raw] ?? (valid.includes(raw) ? raw : 'cockpit');
  if (migrated !== raw) localStorage.setItem('layout', migrated);
  return migrated;
}
export const layout = writable(getInitialLayout());

/** Arena: model id per column (A, B, C, D). Chat uses column A when in arena. */
const getStored = (key) => (typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null) || '';
export const dashboardModelA = writable(getStored('dashboardModelA'));
export const dashboardModelB = writable(getStored('dashboardModelB'));
export const dashboardModelC = writable(getStored('dashboardModelC'));
export const dashboardModelD = writable(getStored('dashboardModelD'));
if (typeof localStorage !== 'undefined') {
  dashboardModelA.subscribe((v) => localStorage.setItem('dashboardModelA', v ?? ''));
  dashboardModelB.subscribe((v) => localStorage.setItem('dashboardModelB', v ?? ''));
  dashboardModelC.subscribe((v) => localStorage.setItem('dashboardModelC', v ?? ''));
  dashboardModelD.subscribe((v) => localStorage.setItem('dashboardModelD', v ?? ''));
}

/** Default model per system-prompt preset (General, Code, Research, Creative). Keys = preset name. */
const getPresetDefaultModels = () => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem('presetDefaultModels');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};
export const presetDefaultModels = writable(getPresetDefaultModels());
if (typeof localStorage !== 'undefined') {
  presetDefaultModels.subscribe((obj) => {
    localStorage.setItem('presetDefaultModels', JSON.stringify(obj ?? {}));
  });
}

/** Model to use for sending chat: in arena layout = column A, else main selector. */
export const effectiveModelId = derived(
  [layout, dashboardModelA, selectedModelId],
  ([$layout, $a, $sid]) => ($layout === 'arena' && $a ? $a : $sid)
);

/** Dark mode: 'dark' | 'light' | 'system' */
export const theme = writable(
  (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) || 'system'
);

const readBool = (key, fallback) => {
  if (typeof localStorage === 'undefined') return fallback;
  const v = localStorage.getItem(key);
  if (v == null) return fallback;
  return v === '1' || v === 'true';
};
const readNum = (key, fallback) => {
  if (typeof localStorage === 'undefined') return fallback;
  const v = localStorage.getItem(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Base defaults (app + generation). Used when no global or per-model override exists. */
const DEFAULT_SETTINGS = {
  temperature: 0.7,
  max_tokens: 4096,
  system_prompt: 'You are a helpful assistant.',
  top_p: 0.95,
  top_k: 64,
  repeat_penalty: 1.15,
  stop: [],
  model_ttl_seconds: 0,
  audio_enabled: readBool('audio_enabled', true),
  audio_clicks: readBool('audio_clicks', true),
  audio_volume: readNum('audio_volume', 0.25),
  context_length: 4096,
  eval_batch_size: 512,
  flash_attention: true,
  offload_kv_cache_to_gpu: true,
  gpu_offload: 'max',
  cpu_threads: 4,
  n_parallel: 4,
};

/** Global default (single set of defaults for all models). Persisted. Migrate once from old settingsByLayout. */
function loadGlobalDefault() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem('globalDefault');
    if (raw) {
      const p = JSON.parse(raw);
      return typeof p === 'object' && p !== null ? p : {};
    }
    const byLayout = localStorage.getItem('settingsByLayout');
    if (byLayout) {
      const parsed = JSON.parse(byLayout);
      const cockpit = parsed?.cockpit ?? parsed?.default ?? parsed?.flow ?? {};
      if (typeof cockpit === 'object' && cockpit !== null && Object.keys(cockpit).length > 0) {
        return cockpit;
      }
    }
  } catch (_) {}
  return {};
}
export const globalDefault = writable(loadGlobalDefault());
if (typeof localStorage !== 'undefined') {
  globalDefault.subscribe((v) => {
    localStorage.setItem('globalDefault', JSON.stringify(v ?? {}));
  });
}

/** Per-model overrides (keyed by model id). Only stored when user explicitly saves for that model. Persisted. */
function loadPerModelOverrides() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem('perModelOverrides');
    if (!raw) return {};
    const p = JSON.parse(raw);
    return typeof p === 'object' && p !== null ? p : {};
  } catch {
    return {};
  }
}
export const perModelOverrides = writable(loadPerModelOverrides());
if (typeof localStorage !== 'undefined') {
  perModelOverrides.subscribe((v) => {
    localStorage.setItem('perModelOverrides', JSON.stringify(v ?? {}));
  });
}

/** Update global default (used when no per-model override). */
export function updateGlobalDefault(patch) {
  globalDefault.update((g) => ({ ...g, ...patch }));
}

/** Set override for a model. Pass null for a key to clear it for that model. */
export function setPerModelOverride(modelId, patch) {
  if (!modelId) return;
  perModelOverrides.update((by) => {
    const next = { ...by };
    const current = next[modelId] ?? {};
    const merged = { ...current, ...patch };
    Object.keys(merged).forEach((k) => {
      if (merged[k] === undefined || merged[k] === '') delete merged[k];
    });
    if (Object.keys(merged).length === 0) delete next[modelId];
    else next[modelId] = merged;
    return next;
  });
}

/** Effective settings for a given model id: base <- globalDefault <- recommended <- perModelOverrides. */
export function getEffectiveSettingsForModel(modelId) {
  const g = get(globalDefault);
  const p = get(perModelOverrides);
  return mergeEffectiveSettings(modelId, g, p);
}

/** Same as getEffectiveSettingsForModel but takes g,p so components can pass reactive store values. */
export function mergeEffectiveSettings(modelId, globalDefaultVal, perModelOverridesVal) {
  const g = globalDefaultVal ?? {};
  const p = perModelOverridesVal ?? {};
  const recommended = modelId ? getRecommendedSettingsForModel(modelId) : {};
  const overrides = modelId ? (p[modelId] ?? {}) : {};
  return { ...DEFAULT_SETTINGS, ...g, ...recommended, ...overrides };
}

/** Effective settings for the currently selected model (cockpit) or arena slot model. Reactive. */
export const settings = derived(
  [globalDefault, perModelOverrides, selectedModelId, layout, dashboardModelA],
  ([$g, $p, $sid, $layout, $a]) => {
    const modelId = $layout === 'arena' && $a ? $a : $sid;
    return getEffectiveSettingsForModel(modelId || '');
  }
);

/** @deprecated Use updateGlobalDefault() or setPerModelOverride(). Kept for compatibility; writes global default. */
export function updateSettings(patch) {
  updateGlobalDefault(patch);
}

/** Whether we're currently streaming a response */
export const isStreaming = writable(false);

/** Error message to show near chat input (e.g. API or model error) */
export const chatError = writable(null);
/** One-shot chat command (regen/export/clear). ChatView subscribes and handles. */
export const chatCommand = writable(null);

/** When true, the next Send will run a web search (DuckDuckGo) with the message text, then send. Toggle via globe button. */
export const webSearchForNextMessage = writable(false);

/** True while a web search is in progress (DuckDuckGo fetch). Show "Searching the web..." UI. */
export const webSearchInProgress = writable(false);

/** True only after a web search or warm-up fetch has succeeded. Drives the green dot on the globe – do not set true without a real successful fetch. */
export const webSearchConnected = writable(false);

/** Last response tokens (set when a response completes). */
export const lastResponseTokens = writable(null);
/** Live token estimate while streaming (approx, resets after stream ends) */
export const liveTokens = writable(null);
/** Live tokens/sec estimate (approx). Used by Arena. */
export const liveTokPerSec = writable(null);

/** Arena: number of model panels to show (1–4). Only this many slots/panels are shown. Saved to localStorage. */
const arenaPanelCountStored = () => {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem('arenaPanelCount') : null;
  const n = Number(v);
  return n >= 1 && n <= 4 ? n : 1;
};
export const arenaPanelCount = writable(arenaPanelCountStored());
if (typeof localStorage !== 'undefined') {
  arenaPanelCount.subscribe((v) => localStorage.setItem('arenaPanelCount', String(v >= 1 && v <= 4 ? v : 1)));
}

/** Arena: when true, Slot A is the judge — it does not answer the prompt; use "Judgment time" to rate B/C/D. */
const arenaSlotAIsJudgeStored = () => readBool('arenaSlotAIsJudge', false);
export const arenaSlotAIsJudge = writable(arenaSlotAIsJudgeStored());

/** Arena: who gets web search. 'none' = no one; 'all' = use globe, all models get it on send; 'judge' = only judge gets it on Judgment time. */
const arenaWebSearchModeStored = () => {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem('arenaWebSearchMode') : null;
  return v === 'none' || v === 'all' || v === 'judge' ? v : 'all';
};
export const arenaWebSearchMode = writable(arenaWebSearchModeStored());
if (typeof localStorage !== 'undefined') {
  arenaSlotAIsJudge.subscribe((v) => localStorage.setItem('arenaSlotAIsJudge', v ? '1' : '0'));
}
if (typeof localStorage !== 'undefined') {
  arenaWebSearchMode.subscribe((v) => localStorage.setItem('arenaWebSearchMode', v === 'none' || v === 'all' || v === 'judge' ? v : 'all'));
}

/** Arena: per-slot overrides for temperature, max_tokens, system_prompt. Key = 'A'|'B'|'C'|'D'. Empty = use layout default. */
function loadArenaSlotOverrides() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem('arenaSlotOverrides');
    if (!raw) return {};
    const p = JSON.parse(raw);
    return typeof p === 'object' && p !== null ? p : {};
  } catch {
    return {};
  }
}
export const arenaSlotOverrides = writable(loadArenaSlotOverrides());
if (typeof localStorage !== 'undefined') {
  arenaSlotOverrides.subscribe((v) => localStorage.setItem('arenaSlotOverrides', JSON.stringify(v ?? {})));
}
/** Update overrides for one Arena slot. Pass null to clear that slot's overrides. */
export function setArenaSlotOverride(slot, patch) {
  arenaSlotOverrides.update((by) => {
    const next = { ...by };
    if (patch == null) {
      delete next[slot];
      return next;
    }
    const merged = { ...(next[slot] ?? {}), ...patch };
    Object.keys(merged).forEach((k) => {
      if (merged[k] === undefined || merged[k] === '') delete merged[k];
    });
    if (Object.keys(merged).length === 0) delete next[slot];
    else next[slot] = merged;
    return next;
  });
}

/** Floating metrics dashboard: open, minimized, position { x, y }, size { width, height }. */
function getFloatingMetricsState() {
  if (typeof localStorage === 'undefined') return { open: true, minimized: false, x: 24, y: 24, width: 220, height: 260 };
  try {
    const raw = localStorage.getItem('floatingMetrics');
    if (!raw) return { open: true, minimized: false, x: 24, y: 24, width: 220, height: 260 };
    const p = JSON.parse(raw);
    const w = Number(p.width);
    const h = Number(p.height);
    return {
      open: p.open !== false,
      minimized: !!p.minimized,
      x: Number(p.x) || 24,
      y: Number(p.y) || 24,
      width: (w >= 200 && w <= 500) ? w : 220,
      height: (h >= 160 && h <= 420) ? h : 260,
    };
  } catch {
    return { open: true, minimized: false, x: 24, y: 24, width: 220, height: 260 };
  }
}
const floatingInit = getFloatingMetricsState();
export const floatingMetricsOpen = writable(floatingInit.open);
export const floatingMetricsMinimized = writable(floatingInit.minimized);
export const floatingMetricsPosition = writable({ x: floatingInit.x, y: floatingInit.y });
export const floatingMetricsSize = writable({ width: floatingInit.width, height: floatingInit.height });
if (typeof localStorage !== 'undefined') {
  function saveFloatingMetrics() {
    const open = get(floatingMetricsOpen);
    const min = get(floatingMetricsMinimized);
    const pos = get(floatingMetricsPosition);
    const sz = get(floatingMetricsSize);
    localStorage.setItem('floatingMetrics', JSON.stringify({ open, minimized: min, x: pos.x, y: pos.y, width: sz.width, height: sz.height }));
  }
  floatingMetricsOpen.subscribe(saveFloatingMetrics);
  floatingMetricsMinimized.subscribe(saveFloatingMetrics);
  floatingMetricsPosition.subscribe(saveFloatingMetrics);
  floatingMetricsSize.subscribe(saveFloatingMetrics);
}

export function pushTokSample(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r)) return;
  liveTokPerSec.set(r);
  tokSeries.update((arr) => {
    const next = arr.length >= 60 ? arr.slice(arr.length - 59) : arr.slice();
    next.push(r);
    return next;
  });
}
