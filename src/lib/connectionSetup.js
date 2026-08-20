/**
 * Connection + model bootstrap for first-run and retry flows.
 */
import { get } from 'svelte/store';
import { checkLmStudioConnection, getModels } from '$lib/api.js';
import { ensureModelIcons } from '$lib/modelIcons.js';
import { localModelIdsMatch, pickInventoryModelId } from '$lib/localModelId.js';
import {
  lmStudioConnected,
  models,
  selectedModelId,
  modelSelectionNotification,
  cloudApisAvailable,
  effectiveModelId,
} from '$lib/stores.js';
import { findSmallestModel } from '$lib/utils/modelSelection.js';

/**
 * @typedef {'checking'|'disconnected'|'cloud_only'|'no_models'|'no_selection'|'ready'} SetupStatus
 */

/**
 * @returns {SetupStatus}
 */
export function deriveSetupStatus() {
  const connected = get(lmStudioConnected);
  const cloud = get(cloudApisAvailable);
  const list = get(models) ?? [];
  const modelId = get(effectiveModelId);

  if (connected === null) return 'checking';
  if (list.length === 0) {
    if (connected === false && !cloud) return 'disconnected';
    if (connected === false && cloud) return 'cloud_only';
    if (connected === true) return 'no_models';
    return 'disconnected';
  }
  if (!modelId || !list.some((m) => m.id === modelId || localModelIdsMatch(m.id, modelId))) return 'no_selection';
  return 'ready';
}

/**
 * Ping LM Studio, refresh model list, auto-pick a model when needed.
 * @returns {Promise<{ connected: boolean, modelCount: number, status: SetupStatus }>}
 */
export async function refreshConnectionAndModels() {
  const connected = await checkLmStudioConnection();
  lmStudioConnected.set(connected);

  try {
    const list = await getModels();
    const ids = list.map((m) => m.id).filter(Boolean);
    models.set(ids.map((id) => ({ id })));
    if (ids.length) ensureModelIcons(ids);

    const stored =
      typeof localStorage !== 'undefined' ? (localStorage.getItem('selectedModel') || '').trim() : '';
    const current = (get(selectedModelId) || '').trim();
    const storedValid = stored && ids.some((id) => localModelIdsMatch(id, stored));
    const currentValid = current && ids.some((id) => localModelIdsMatch(id, current));

    if (ids.length === 0) {
      if (connected) {
        modelSelectionNotification.set(
          'LM Studio is running but no models are available. Load a model in LM Studio, or add a cloud API key in Settings.',
        );
      } else if (get(cloudApisAvailable)) {
        modelSelectionNotification.set(
          'Add a chat API key (DeepSeek, Grok, or Cerebras) in Settings to use cloud models.',
        );
      } else {
        modelSelectionNotification.set(
          'Start LM Studio and load a model, or add a cloud API key in Settings.',
        );
      }
      return { connected, modelCount: 0, status: deriveSetupStatus() };
    }

    if (!currentValid) {
      const fromStored = stored ? pickInventoryModelId(stored, ids) : null;
      const pick = (fromStored && ids.some((id) => localModelIdsMatch(id, fromStored))) ? fromStored : findSmallestModel(ids);
      if (pick) {
        selectedModelId.set(pick);
        if (stored && !storedValid) {
          modelSelectionNotification.set(`Selected ${pick} — your previous model is unavailable.`);
          setTimeout(() => modelSelectionNotification.set(null), 6000);
        } else if (!stored) {
          modelSelectionNotification.set(`Selected ${pick}. Change anytime from the model menu.`);
          setTimeout(() => modelSelectionNotification.set(null), 5000);
        } else {
          modelSelectionNotification.set(null);
        }
      }
    } else {
      const canonical = pickInventoryModelId(current, ids);
      if (canonical && canonical !== current && ids.includes(canonical)) selectedModelId.set(canonical);
      modelSelectionNotification.set(null);
    }

    return { connected, modelCount: ids.length, status: deriveSetupStatus() };
  } catch (e) {
    console.warn('refreshConnectionAndModels:', e);
    models.set([]);
    modelSelectionNotification.set('Could not load models. Check Settings → Connection, then retry.');
    return { connected: false, modelCount: 0, status: deriveSetupStatus() };
  }
}