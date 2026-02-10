import { writable, derived, get } from 'svelte/store';
import { detectHardware } from '$lib/hardware.js';

/** Currently selected conversation id or null */
export const activeConversationId = writable(null);

/** List of conversations for sidebar */
export const conversations = writable([]);

/** Messages for the active conversation (reactive) */
export const activeMessages = writable([]);

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

/** UI: sidebar collapsed to narrow strip on desktop (toggle via logo/icon). */
export const sidebarCollapsed = writable(false);

/** Cockpit layout: right Intel panel open (toggle with ]). */
export const cockpitIntelOpen = writable(true);

/** Workbench layout: pinned assistant message (markdown string or null). */
export const pinnedContent = writable(null);


/** Color scheme: default (red) | cyberpunk | neural | quantum */
export const uiTheme = writable(
  (typeof localStorage !== 'undefined' && localStorage.getItem('uiTheme')) || 'default'
);

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

/** Default model parameters (one layout's worth). Per-layout settings merge over this. */
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
  audio_typing: readBool('audio_typing', false),
  audio_volume: readNum('audio_volume', 0.25),
  context_length: 4096,
  eval_batch_size: 512,
  flash_attention: true,
  offload_kv_cache_to_gpu: true,
  gpu_offload: 'max',
  cpu_threads: 4,
};

/** Model parameters per layout. Key = layout id (cockpit | arena). Persisted to localStorage. Migrate old keys. */
const loadSettingsByLayout = () => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem('settingsByLayout');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const out = typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
    if (out.default != null && out.cockpit == null) out.cockpit = out.default;
    if (out.flow != null && out.cockpit == null) out.cockpit = out.flow;
    if (out.dashboard != null && out.arena == null) out.arena = out.dashboard;
    return out;
  } catch {
    return {};
  }
};
export const settingsByLayout = writable(loadSettingsByLayout());
if (typeof localStorage !== 'undefined') {
  settingsByLayout.subscribe((by) => {
    localStorage.setItem('settingsByLayout', JSON.stringify(by ?? {}));
  });
}

/** Effective settings for the current layout (read-only). Use updateSettings() to change. */
export const settings = derived(
  [layout, settingsByLayout],
  ([$layout, $by]) => ({ ...DEFAULT_SETTINGS, ...($by[$layout] ?? {}) })
);

/** Update model parameters for the current layout. */
export function updateSettings(patch) {
  const l = get(layout);
  settingsByLayout.update((by) => ({
    ...by,
    [l]: { ...(by[l] ?? {}), ...patch },
  }));
}

/** Whether we're currently streaming a response */
export const isStreaming = writable(false);

/** Error message to show near chat input (e.g. API or model error) */
export const chatError = writable(null);
/** One-shot chat command (regen/export/clear) */
export const chatCommand = writable(null);

/** When set, ChatInput inserts this text into the input (then clears). Used by suggestion buttons. */
export const insertIntoInput = writable('');
/** When set, ChatInput appends this text to the input (then clears). Used by quick-prompt chips. */
export const insertAppend = writable('');

/** When true, the next Send will run a web search (DuckDuckGo) with the message text, then send. Toggle via globe button. */
export const webSearchForNextMessage = writable(false);

/** True while a web search is in progress (DuckDuckGo fetch). Show "Searching the web..." UI. */
export const webSearchInProgress = writable(false);

/** When set, ChatInput shows elaboration options below the input. { baseText: string, options: string[] } */
export const suggestionExpanded = writable(null);

/** Last response metrics for header (set when a response completes) */
export const lastResponseTokPerSec = writable(null);
export const lastResponseTokens = writable(null);
/** Live token estimate while streaming (approx, resets after stream ends) */
export const liveTokens = writable(null);
/** Live tokens/sec estimate (approx) */
export const liveTokPerSec = writable(null);
/** Rolling 60s sparkline of tokens/sec */
export const tokSeries = writable([]);

/** Dynamic UI: Performance mode disables gradient bg and heavy animations. */
export const performanceMode = writable(readBool('performanceMode', false));
if (typeof localStorage !== 'undefined') {
  performanceMode.subscribe((v) => localStorage.setItem('performanceMode', v ? '1' : '0'));
}

/** Arena: number of model panels (1–4). Saved to localStorage. */
const arenaPanelCountStored = () => {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem('arenaPanelCount') : null;
  const n = Number(v);
  return n >= 1 && n <= 4 ? n : 3;
};
export const arenaPanelCount = writable(arenaPanelCountStored());
if (typeof localStorage !== 'undefined') {
  arenaPanelCount.subscribe((v) => localStorage.setItem('arenaPanelCount', String(v >= 1 && v <= 4 ? v : 3)));
}

/** Arena: when true, Slot A is the judge — it does not answer the prompt; use "Judgment time" to rate B/C/D. */
const arenaSlotAIsJudgeStored = () => readBool('arenaSlotAIsJudge', false);
export const arenaSlotAIsJudge = writable(arenaSlotAIsJudgeStored());
if (typeof localStorage !== 'undefined') {
  arenaSlotAIsJudge.subscribe((v) => localStorage.setItem('arenaSlotAIsJudge', v ? '1' : '0'));
}

/** Floating metrics dashboard: open, minimized, position { x, y }. */
function getFloatingMetricsState() {
  if (typeof localStorage === 'undefined') return { open: true, minimized: false, x: 24, y: 24 };
  try {
    const raw = localStorage.getItem('floatingMetrics');
    if (!raw) return { open: true, minimized: false, x: 24, y: 24 };
    const p = JSON.parse(raw);
    return {
      open: p.open !== false,
      minimized: !!p.minimized,
      x: Number(p.x) || 24,
      y: Number(p.y) || 24,
    };
  } catch {
    return { open: true, minimized: false, x: 24, y: 24 };
  }
}
const floatingInit = getFloatingMetricsState();
export const floatingMetricsOpen = writable(floatingInit.open);
export const floatingMetricsMinimized = writable(floatingInit.minimized);
export const floatingMetricsPosition = writable({ x: floatingInit.x, y: floatingInit.y });
if (typeof localStorage !== 'undefined') {
  floatingMetricsOpen.subscribe((open) => {
    const min = get(floatingMetricsMinimized);
    const pos = get(floatingMetricsPosition);
    localStorage.setItem('floatingMetrics', JSON.stringify({ open, minimized: min, x: pos.x, y: pos.y }));
  });
  floatingMetricsMinimized.subscribe((minimized) => {
    const open = get(floatingMetricsOpen);
    const pos = get(floatingMetricsPosition);
    localStorage.setItem('floatingMetrics', JSON.stringify({ open, minimized, x: pos.x, y: pos.y }));
  });
  floatingMetricsPosition.subscribe((pos) => {
    const open = get(floatingMetricsOpen);
    const min = get(floatingMetricsMinimized);
    localStorage.setItem('floatingMetrics', JSON.stringify({ open, minimized: min, x: pos.x, y: pos.y }));
  });
}

/** Brief flash when a response completes (green). Set by ChatView, cleared after 400ms. */
export const responseCompleteFlash = writable(false);

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

export function resetTokSeries() {
  liveTokPerSec.set(null);
  tokSeries.set([]);
}

/** Resolved dark class for document (for Tailwind dark mode) */
export const darkClass = derived(theme, ($theme) => {
  if (typeof document === 'undefined') return '';
  if ($theme === 'dark') return 'dark';
  if ($theme === 'light') return '';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : '';
});

// Chat state stores
export const messages = writable([]);
export const currentResponse = writable('');
