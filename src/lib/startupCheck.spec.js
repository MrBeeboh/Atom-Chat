import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { get } from 'svelte/store';
import { CLOUD_PROVIDERS, fetchCloudModels, invalidateCloudModelCache, resetStartupFundingCheckForTests } from './cloudCatalog.js';
import {
  assistantShowsModelName,
  buildProviderCheckRow,
  extractProviderPrices,
  providerStartupReport,
  providerStatusText,
  resetProviderFundingSession,
} from './providerFunding.js';

const PROVIDERS = ['deepseek', 'deepinfra', 'grok', 'cerebras', 'nous'];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function responseFor(url) {
  const href = String(url);
  if (href.includes('deepseek')) {
    return jsonResponse({ data: [{ id: 'deepseek-v4-flash', object: 'model' }] });
  }
  if (href.includes('deepinfra')) {
    return jsonResponse({
      data: [{
        id: 'google/gemma-3-4b-it',
        metadata: { pricing: { input_tokens: 0.04, output_tokens: 0.08 } },
      }],
    });
  }
  if (href.includes('x.ai') || href.includes('/api/xai')) {
    return new Response('{"code":"permission-denied","error":"used all available credits"}', { status: 403 });
  }
  if (href.includes('cerebras')) {
    return new Response('unauthorized', { status: 401 });
  }
  if (href.includes('nous')) {
    return jsonResponse({
      data: [{ id: 'nousresearch/hermes-3-llama-3.1-405b', pricing: { prompt: '0.000002', completion: '0.000006' } }],
    });
  }
  return jsonResponse({ data: [] });
}

describe('page load funding and pricing', () => {
  let originalFetch;
  let originalKeys;
  let urls;

  beforeEach(() => {
    invalidateCloudModelCache();
    resetStartupFundingCheckForTests();
    resetProviderFundingSession();
    urls = [];
    originalFetch = globalThis.fetch;
    originalKeys = Object.fromEntries(PROVIDERS.map((id) => [id, CLOUD_PROVIDERS[id].getKey]));
    for (const id of PROVIDERS) CLOUD_PROVIDERS[id].getKey = () => 'test-key';
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return responseFor(url);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const id of PROVIDERS) CLOUD_PROVIDERS[id].getKey = originalKeys[id];
    invalidateCloudModelCache();
    resetStartupFundingCheckForTests();
    resetProviderFundingSession();
  });

  it('runs one models inquiry per provider and does not fetch again', async () => {
    await fetchCloudModels();
    expect(urls).toHaveLength(PROVIDERS.length);
    expect(new Set(urls).size).toBe(PROVIDERS.length);
    invalidateCloudModelCache();
    await fetchCloudModels();
    expect(urls).toHaveLength(PROVIDERS.length);
  });

  it('records funding and pricing for deepseek, deepinfra, grok, cerebras, and nous', async () => {
    await fetchCloudModels();
    const rows = Object.fromEntries(get(providerStartupReport).map((row) => [row.id, row]));
    expect(Object.keys(rows).sort()).toEqual([...PROVIDERS].sort());

    expect(rows.deepseek.funded).toBe(true);
    expect(rows.deepseek.fundingState).toBe('fresh');
    expect(rows.deepseek.priceState).toBe('stale');
    expect(rows.deepseek.prices).toEqual([]);
    expect(providerStatusText(rows.deepseek)).toContain('DeepSeek');
    expect(providerStatusText(rows.deepseek)).toContain('price stale');

    expect(rows.deepinfra.funded).toBe(true);
    expect(rows.deepinfra.priceState).toBe('fresh');
    expect(rows.deepinfra.prices[0]).toMatchObject({ id: 'google/gemma-3-4b-it', inPerM: 0.04, outPerM: 0.08, unit: 'usd_per_million' });

    expect(rows.grok.funded).toBe(false);
    expect(rows.grok.fundingState).toBe('fresh');
    expect(rows.grok.priceState).toBe('error');
    expect(providerStatusText(rows.grok)).toContain('Grok check failed');
    expect(rows.grok.prices).toEqual([]);

    expect(rows.cerebras.funded).toBe(false);
    expect(providerStatusText(rows.cerebras)).toContain('Cerebras check failed');

    expect(rows.nous.funded).toBe(true);
    expect(rows.nous.priceState).toBe('fresh');
    expect(rows.nous.prices[0].inPerM).toBeCloseTo(2);
    expect(rows.nous.prices[0].outPerM).toBeCloseTo(6);

    const app = fs.readFileSync(new URL('../App.svelte', import.meta.url), 'utf8');
    const connection = fs.readFileSync(new URL('./connectionSetup.js', import.meta.url), 'utf8');
    expect(app).toContain('refreshConnectionAndModels');
    expect(connection).toContain('const list = await getModels();');
  });
});

describe('provider check errors and staleness', () => {
  it('names a provider with no key instead of dropping it', () => {
    const row = buildProviderCheckRow({ id: 'cerebras', name: 'Cerebras', hasKey: false });
    expect(row.fundingState).toBe('error');
    expect(row.priceState).toBe('error');
    expect(providerStatusText(row)).toBe('Cerebras check failed: no saved API key');
    expect(row.prices).toEqual([]);
  });

  it('marks a missing price stale and does not invent a number', () => {
    const row = buildProviderCheckRow({
      id: 'deepseek',
      name: 'DeepSeek',
      hasKey: true,
      status: 200,
      body: { data: [{ id: 'deepseek-v4-flash' }] },
    });
    expect(row.priceState).toBe('stale');
    expect(row.prices).toEqual([]);
    expect(providerStatusText(row)).not.toMatch(/\$\d/);
  });

  it('keeps an older in-memory price only when a later fetch fails', () => {
    const prior = buildProviderCheckRow({
      id: 'nous',
      name: 'Nous',
      hasKey: true,
      status: 200,
      body: { data: [{ id: 'a', pricing: { prompt: '0.000001', completion: '0.000002' } }] },
    });
    const again = buildProviderCheckRow({
      id: 'nous',
      name: 'Nous',
      hasKey: true,
      timedOut: true,
      prior,
    });
    expect(again.fundingState).toBe('stale');
    expect(again.priceState).toBe('stale');
    expect(again.prices[0].inPerM).toBeCloseTo(1);
    expect(providerStatusText(again)).toContain('Nous check failed: timed out');
  });

  it('does not show a stale price when the first fetch fails', () => {
    const row = buildProviderCheckRow({ id: 'grok', name: 'Grok', hasKey: true, status: 0 });
    expect(row.fundingState).toBe('error');
    expect(row.prices).toEqual([]);
    expect(providerStatusText(row)).toBe('Grok check failed: network error');
  });

  it('reads Nous per-token prices and DeepInfra per-million prices from the same payload', () => {
    const nous = extractProviderPrices({ data: [{ id: 'm', pricing: { prompt: '0.000002', completion: '0.000006' } }] });
    expect(nous[0]).toMatchObject({ inPerM: 2, outPerM: 6, rawUnit: 'per_token' });
    const infra = extractProviderPrices({ data: [{ id: 'g', metadata: { pricing: { input_tokens: 1.2, output_tokens: 6 } } }] });
    expect(infra[0]).toMatchObject({ inPerM: 1.2, outPerM: 6, rawUnit: 'metadata.pricing per 1M tokens' });
  });
});

describe('anonymous column', () => {
  it('hides the model name and still renders the answer', () => {
    expect(assistantShowsModelName('DEEPINFRA: GOOGLE/GEMMA-3-4B-IT', true)).toBe(false);
    expect(assistantShowsModelName('DEEPINFRA: GOOGLE/GEMMA-3-4B-IT', false)).toBe(true);
    const src = fs.readFileSync(new URL('./components/MessageBubble.svelte', import.meta.url), 'utf8');
    const assistant = src.split('{:else if isAssistant}')[1];
    expect(assistant).toContain('assistantShowsModelName(modelLabel, hideModelName)');
    const labelBlock = assistant.split('assistantShowsModelName(modelLabel, hideModelName)')[1].split('{/if}')[0];
    expect(labelBlock).toContain('{modelLabel}');
    expect(labelBlock).not.toContain('{@html');
    const afterName = assistant.split('{/if}')[1];
    expect(afterName).toContain('{@html part.html}');
    expect(afterName).toContain('{@html html}');
  });
});

describe('desktop shortcut', () => {
  it('starts the UI on 5175 and does not signal llama or ports 8080, 8081, or 18081', () => {
    const desktop = fs.readFileSync('/home/mike/Desktop/ATOM Chat.desktop', 'utf8');
    const menu = fs.readFileSync('/home/mike/.local/share/applications/atom-chat.desktop', 'utf8');
    const script = fs.readFileSync(new URL('../../scripts/start-atom-ui.sh', import.meta.url), 'utf8');
    for (const file of [desktop, menu]) {
      expect(file).toContain('Exec=/home/mike/atom-chat/scripts/start-atom-ui.sh');
      expect(file).toContain('Terminal=true');
      expect(file).toContain('Path=/home/mike/atom-chat');
    }
    expect(script).toContain('--port 5175');
    expect(script).not.toMatch(/llama-server/);
    expect(script).not.toMatch(/--port 8080|--port 8081|--port 18081/);
    expect(script).not.toMatch(/sport = :8080|sport = :8081|sport = :18081/);
    const kills = script.split('\n').filter((line) => /\bkill\b/.test(line) && !line.trim().startsWith('#'));
    expect(kills.length).toBeGreaterThan(0);
    for (const line of kills) {
      expect(line).toContain('UI_PID');
      expect(line).not.toMatch(/8080|8081|18081|llama/);
    }
  });
});
