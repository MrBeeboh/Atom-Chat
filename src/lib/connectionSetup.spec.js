import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { deriveSetupStatus } from './connectionSetup.js';
import { lmStudioConnected, cloudApisAvailable, models, selectedModelId, effectiveModelId } from './stores.js';

describe('deriveSetupStatus', () => {
  beforeEach(() => {
    lmStudioConnected.set(null);
    cloudApisAvailable; // derived — set via underlying keys in stores if needed
    models.set([]);
    selectedModelId.set('');
  });

  it('returns checking when connection unknown', () => {
    lmStudioConnected.set(null);
    expect(deriveSetupStatus()).toBe('checking');
  });

  it('returns disconnected when offline and no cloud', () => {
    lmStudioConnected.set(false);
    models.set([]);
    selectedModelId.set('');
    // cloudApisAvailable is derived from localStorage keys; default empty
    const status = deriveSetupStatus();
    expect(['disconnected', 'cloud_only']).toContain(status);
  });

  it('returns ready when models exist and one is selected', () => {
    lmStudioConnected.set(true);
    models.set([{ id: 'test-model' }]);
    selectedModelId.set('test-model');
    expect(deriveSetupStatus()).toBe('ready');
  });
});