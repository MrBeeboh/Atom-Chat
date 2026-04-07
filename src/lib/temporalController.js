/**
 * @file temporalController.js
 * @description Temporal theme: mutates CSS variables on root based on time-of-day and conversation
 * depth. Does not touch MessageList, ChatView, or high-frequency paths. No store required.
 * Time check ≤ 60s; depth reactive only to activeMessages.length change.
 */
import { derived, get } from 'svelte/store';

const TIME_INTERVAL_MS = 60_000;

/** 05:00–11:59 morning, 12:00–17:59 afternoon, 18:00–22:59 night, 23:00–04:59 late-night */
function getTimeMode() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'night';
  return 'late-night';
}

/** 0–5 minimal, 6–20 moderate, 21–60 layered, 61+ immersive */
function getDepthTier(length) {
  if (length <= 5) return 'minimal';
  if (length <= 20) return 'moderate';
  if (length <= 60) return 'layered';
  return 'immersive';
}

/** Token values only; no raw colors. Keys are CSS custom property names. */
const TIME_VARS = {
  morning: {
    '--ui-bg-intensity': 0.92,
    '--ui-saturation': 0.95,
    '--ui-depth-multiplier': 0.9,
    '--ui-blur-strength': 0.85,
    '--ui-shadow-depth': 0.9,
    '--ui-panel-separation': 0.95,
  },
  afternoon: {
    '--ui-bg-intensity': 1,
    '--ui-saturation': 1,
    '--ui-depth-multiplier': 1,
    '--ui-blur-strength': 1,
    '--ui-shadow-depth': 1,
    '--ui-panel-separation': 1,
  },
  night: {
    '--ui-bg-intensity': 0.96,
    '--ui-saturation': 1.05,
    '--ui-depth-multiplier': 1.1,
    '--ui-blur-strength': 1.1,
    '--ui-shadow-depth': 1.15,
    '--ui-panel-separation': 1.05,
  },
  'late-night': {
    '--ui-bg-intensity': 0.88,
    '--ui-saturation': 0.9,
    '--ui-depth-multiplier': 1.2,
    '--ui-blur-strength': 1.15,
    '--ui-shadow-depth': 1.25,
    '--ui-panel-separation': 1.1,
  },
};

const DEPTH_VARS = {
  minimal: {
    '--ui-shadow-depth': 0.85,
    '--ui-texture-opacity': 0,
    '--ui-panel-separation': 0.9,
  },
  moderate: {
    '--ui-shadow-depth': 1,
    '--ui-texture-opacity': 0.03,
    '--ui-panel-separation': 1,
  },
  layered: {
    '--ui-shadow-depth': 1.2,
    '--ui-texture-opacity': 0.06,
    '--ui-panel-separation': 1.1,
  },
  immersive: {
    '--ui-shadow-depth': 1.4,
    '--ui-texture-opacity': 0.1,
    '--ui-panel-separation': 1.2,
  },
};

const NEUTRAL_VARS = {
  '--ui-bg-intensity': 1,
  '--ui-saturation': 1,
  '--ui-depth-multiplier': 1,
  '--ui-blur-strength': 1,
  '--ui-shadow-depth': 1,
  '--ui-panel-separation': 1,
  '--ui-texture-opacity': 0,
};

/** Only call setProperty when the value actually changed (DOM write guard). */
function applyVars(vars) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    const str = String(value);
    if (root.style.getPropertyValue(key).trim() !== str) {
      root.style.setProperty(key, str);
    }
  }
}

function mergeTemporalVars(timeMode, depthTier) {
  const timeVars = TIME_VARS[timeMode] || TIME_VARS.afternoon;
  const depthVars = DEPTH_VARS[depthTier] || DEPTH_VARS.minimal;
  return { ...NEUTRAL_VARS, ...timeVars, ...depthVars };
}

function applyTemporal(timeMode, depthTier) {
  applyVars(mergeTemporalVars(timeMode, depthTier));
}

/**
 * Start the temporal controller. Only runs when uiTheme is 'temporal'.
 * @param {import('svelte/store').Writable<any[]>} activeMessagesStore
 * @param {import('svelte/store').Writable<string>} uiThemeStore
 * @returns {() => void} stop function
 */
export function startTemporalController(activeMessagesStore, uiThemeStore) {
  let timeIntervalId = null;
  let unsubDepth = null;
  let unsubTheme = null;

  /** Only .length is observed; Svelte derived uses === so content edits (same length) do not trigger. */
  const depthStore = derived(activeMessagesStore, (msgs) => (msgs || []).length);

  let lastTimeMode = null;
  let lastDepthTier = null;
  let lastKnownLength = 0;

  function runTemporal(timeMode, depthTier) {
    applyTemporal(timeMode, depthTier);
  }

  function stop() {
    if (timeIntervalId) {
      clearInterval(timeIntervalId);
      timeIntervalId = null;
    }
    if (unsubDepth) {
      unsubDepth();
      unsubDepth = null;
    }
    if (unsubTheme) {
      unsubTheme();
      unsubTheme = null;
    }
    lastTimeMode = null;
    lastDepthTier = null;
    applyVars(NEUTRAL_VARS);
  }

  function start() {
    const initialLen = (get(activeMessagesStore) || []).length;
    lastTimeMode = getTimeMode();
    lastDepthTier = getDepthTier(initialLen);
    lastKnownLength = initialLen;
    runTemporal(lastTimeMode, lastDepthTier);

    timeIntervalId = setInterval(() => {
      const timeMode = getTimeMode();
      if (timeMode !== lastTimeMode) {
        lastTimeMode = timeMode;
        runTemporal(lastTimeMode, getDepthTier(lastKnownLength));
      }
    }, TIME_INTERVAL_MS);

    unsubDepth = depthStore.subscribe((len) => {
      lastKnownLength = len;
      const tier = getDepthTier(len);
      if (tier !== lastDepthTier) {
        lastDepthTier = tier;
        runTemporal(lastTimeMode, lastDepthTier);
      }
    });
  }

  unsubTheme = uiThemeStore.subscribe((theme) => {
    if (theme === 'temporal') {
      if (!timeIntervalId) start();
    } else {
      stop();
    }
  });

  if (get(uiThemeStore) === 'temporal') {
    start();
  }

  return () => {
    stop();
    if (unsubTheme) {
      unsubTheme();
      unsubTheme = null;
    }
  };
}
