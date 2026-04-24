const STORAGE_KEY_PREFIX = 'arena_';

function slotKey(conversationId, slot) {
  return `${STORAGE_KEY_PREFIX}messages_${conversationId}_${slot}`;
}

export function saveArenaSlotMessages(sessionStorageOrNull, slotsMap) {
  const storage = sessionStorageOrNull || null;
  if (!storage) return { ok: true };
  try {
    for (const slot of ['A', 'B', 'C', 'D']) {
      if (slotsMap[slot]) {
        storage.setItem(`arenaMessages${slot}`, JSON.stringify(slotsMap[slot]));
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

export function loadArenaSlotMessages(sessionStorageOrNull) {
  const storage = sessionStorageOrNull || null;
  const data = { A: [], B: [], C: [], D: [] };
  if (!storage) return { ok: true, data };
  try {
    for (const slot of ['A', 'B', 'C', 'D']) {
      const raw = storage.getItem(`arenaMessages${slot}`);
      if (raw) {
        data[slot] = JSON.parse(raw);
      }
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e, data };
  }
}

export function loadPanelPosition(key, defaultX, defaultY) {
  return { x: defaultX || 24, y: defaultY || 24 };
}

export function readArenaScoresFromLocalStorage() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem('arenaScores');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function readArenaPanelWidths() {
  if (typeof localStorage === 'undefined') return [25, 25, 25, 25];
  try {
    const raw = localStorage.getItem('arenaPanelWidths');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length >= 2) return parsed;
    }
  } catch {}
  return [25, 25, 25, 25];
}

export function writeArenaPanelWidths(widths) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem('arenaPanelWidths', JSON.stringify(widths));
  } catch {}
}
