<script>
  import { fly } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import { globalDefault, updateGlobalDefault, selectedModelId, models, presetDefaultModels, lmStudioBaseUrl, voiceServerUrl, lmStudioUnloadHelperUrl, deepSeekApiKey, grokApiKey, togetherApiKey, deepinfraApiKey, braveApiKey } from '$lib/stores.js';
  import { syncBraveKeyToProxy } from '$lib/duckduckgo.js';

  let { onclose } = $props();

  const DEFAULTS = {
    audio_enabled: true,
    audio_clicks: true,
    audio_volume: 0.25,
  };

  let audioEnabled = $state(DEFAULTS.audio_enabled);
  let audioClicks = $state(DEFAULTS.audio_clicks);
  let audioVolume = $state(DEFAULTS.audio_volume);

  $effect(() => {
    const g = $globalDefault;
    audioEnabled = g.audio_enabled ?? DEFAULTS.audio_enabled;
    audioClicks = g.audio_clicks ?? DEFAULTS.audio_clicks;
    audioVolume = g.audio_volume ?? DEFAULTS.audio_volume;
  });

  const PRESETS = [
    { name: 'General', prompt: 'You are a helpful assistant.' },
    { name: 'Code', prompt: 'You are an expert programmer. Be concise. Prefer code over prose when relevant.' },
    { name: 'Research', prompt: 'You are a thorough researcher. Cite sources when possible. Structure answers with clear sections.' },
    { name: 'Creative', prompt: 'You are a creative writer. Use vivid language and varied structure. Be engaging and original.' },
  ];


  function setPresetDefaultModel(presetName, modelId) {
    presetDefaultModels.update((m) => {
      const next = { ...m };
      if (modelId) next[presetName] = modelId;
      else delete next[presetName];
      return next;
    });
    if (modelId) selectedModelId.set(modelId);
  }

  function save() {
    updateGlobalDefault({
      audio_enabled: !!audioEnabled,
      audio_clicks: !!audioClicks,
      audio_volume: Math.max(0, Math.min(1, Number(audioVolume) || 0)),
    });
    onclose?.();
  }

  function resetToDefaults() {
    audioEnabled = DEFAULTS.audio_enabled;
    audioClicks = DEFAULTS.audio_clicks;
    audioVolume = DEFAULTS.audio_volume;
  }
</script>

<div
  class="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
  role="dialog"
  aria-modal="true"
  aria-label="Settings">
  <div
    class="bg-white dark:bg-zinc-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden border border-zinc-200 dark:border-zinc-700 flex flex-col"
    in:fly={{ x: 300, duration: 400, easing: backOut }}
    out:fly={{ x: 300, duration: 300, easing: quintOut }}>
    <div class="shrink-0 px-6 pt-5 pb-2 border-b border-zinc-200 dark:border-zinc-700 flex items-start justify-between gap-2">
      <div>
        <h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Settings</h2>
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Connection &amp; API keys. Model/load settings are in the Intel panel (right).</p>
      </div>
      <button type="button" class="shrink-0 p-1.5 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 text-xl leading-none" onclick={() => onclose?.()} title="Close" aria-label="Close">✕</button>
    </div>
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-3">
      <details class="border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden group" open>
        <summary class="px-4 py-3 cursor-pointer list-none bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-600 text-sm font-medium text-zinc-700 dark:text-zinc-300">Connection</summary>
        <div class="px-4 py-3 space-y-3">
          <div>
            <label for="settings-lmstudio-url" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400">LM Studio URL</label>
            <input id="settings-lmstudio-url" type="url" bind:value={$lmStudioBaseUrl} placeholder="http://localhost:1234" class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm font-mono placeholder:text-zinc-400" />
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Empty = localhost:1234. Enable CORS in LM Studio → Developer.</p>
          </div>
          <div>
            <label for="settings-unload-helper-url" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400">Unload helper URL</label>
            <input id="settings-unload-helper-url" type="url" bind:value={$lmStudioUnloadHelperUrl} placeholder="http://localhost:8766" class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm font-mono placeholder:text-zinc-400" />
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Optional. <code class="bg-zinc-200 dark:bg-zinc-700 px-1 rounded">python scripts/unload_helper_server.py</code>. Leave empty to disable.</p>
          </div>
          <div>
            <label for="settings-voice-url" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400">Voice server URL</label>
            <input id="settings-voice-url" type="url" bind:value={$voiceServerUrl} placeholder="http://localhost:8765" class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm font-mono placeholder:text-zinc-400" />
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Mic/voice. Default port 8765; see voice-server/README.</p>
          </div>
        </div>
      </details>

      <details class="border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden group">
        <summary class="px-4 py-3 cursor-pointer list-none bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-600 text-sm font-medium text-zinc-700 dark:text-zinc-300">API keys</summary>
        <div class="px-4 py-3 space-y-4">
          <p class="text-xs text-zinc-500 dark:text-zinc-400">Keys stored in browser only. Set to show models in dropdown.</p>
          <div>
            <label for="settings-deepseek-key" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400">DeepSeek API key</label>
            <input
              id="settings-deepseek-key"
              type="password"
              autocomplete="off"
              bind:value={$deepSeekApiKey}
              placeholder="API key (paste without extra spaces)"
              class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm font-mono placeholder:text-zinc-400" />
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1"><a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer" class="underline">platform.deepseek.com</a></p>
          </div>
          <div>
            <label for="settings-grok-key" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400">Grok (xAI) API key</label>
            <input
              id="settings-grok-key"
              type="password"
              autocomplete="off"
              bind:value={$grokApiKey}
              placeholder="xai-…"
              class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm font-mono placeholder:text-zinc-400" />
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1"><a href="https://console.x.ai" target="_blank" rel="noopener noreferrer" class="underline">console.x.ai</a></p>
          </div>
          <div>
            <label for="settings-brave-key" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400">Brave Search API key (web search)</label>
            <input
              id="settings-brave-key"
              type="password"
              autocomplete="off"
              bind:value={$braveApiKey}
              onblur={() => syncBraveKeyToProxy($braveApiKey)}
              placeholder="Paste your Brave Search API key"
              class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm font-mono placeholder:text-zinc-400" />
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Web search (globe). <a href="https://search.brave.com/help/api" target="_blank" rel="noopener noreferrer" class="underline">search.brave.com/help/api</a></p>
          </div>
          <div>
            <label for="settings-deepinfra-key" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400">DeepInfra API key (image + video when DeepSeek)</label>
            <input
              id="settings-deepinfra-key"
              type="password"
              autocomplete="off"
              bind:value={$deepinfraApiKey}
              placeholder="…"
              class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm font-mono placeholder:text-zinc-400" />
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Image/video when DeepSeek. <a href="https://deepinfra.com" target="_blank" rel="noopener noreferrer" class="underline">deepinfra.com</a></p>
          </div>
          <div>
            <label for="settings-together-key" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400">Together AI API key (legacy image when DeepSeek)</label>
            <input
              id="settings-together-key"
              type="password"
              autocomplete="off"
              bind:value={$togetherApiKey}
              placeholder="…"
              class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm font-mono placeholder:text-zinc-400" />
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Legacy image when DeepSeek. <a href="https://api.together.xyz" target="_blank" rel="noopener noreferrer" class="underline">api.together.xyz</a></p>
          </div>
        </div>
      </details>

      <details class="border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden group">
        <summary class="px-4 py-3 cursor-pointer list-none bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-600 text-sm font-medium text-zinc-700 dark:text-zinc-300">Audio</summary>
        <div class="px-4 py-3 space-y-3">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={audioEnabled} class="rounded border-zinc-300 dark:border-zinc-600 accent-themed" />
            <span class="text-sm text-zinc-700 dark:text-zinc-300">Enable audio feedback</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={audioClicks} disabled={!audioEnabled} class="rounded border-zinc-300 dark:border-zinc-600 accent-themed" />
            <span class="text-sm text-zinc-700 dark:text-zinc-300">Click sounds</span>
          </label>
          <div>
            <label for="settings-audio-volume" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Volume</label>
            <input id="settings-audio-volume" type="range" min="0" max="1" step="0.05" bind:value={audioVolume} disabled={!audioEnabled} class="w-full h-2 rounded-full accent-themed" />
          </div>
        </div>
      </details>

      <details class="border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden group">
        <summary class="px-4 py-3 cursor-pointer list-none bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-600 text-sm font-medium text-zinc-700 dark:text-zinc-300">Preset default models</summary>
        <div class="px-4 py-3">
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Model to switch to when selecting a preset from the header.</p>
          <div class="space-y-2">
            {#each PRESETS as p}
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-zinc-600 dark:text-zinc-400 min-w-[4rem]">{p.name}:</span>
                <select class="text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-2 py-1 min-w-[140px]" value={$presetDefaultModels[p.name] ?? ''} onchange={(e) => setPresetDefaultModel(p.name, e.currentTarget.value || null)} aria-label="Default model for {p.name}">
                  <option value="">None</option>
                  {#each $models as m}
                    <option value={m.id}>{m.id}</option>
                  {/each}
                </select>
              </div>
            {/each}
          </div>
        </div>
      </details>

    </div>

    <div class="shrink-0 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 flex justify-between gap-2">
      <button type="button" class="px-3 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400" onclick={resetToDefaults}>Reset to defaults</button>
      <div class="flex gap-2">
        <button type="button" class="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300" onclick={() => onclose?.()}>Cancel</button>
        <button type="button" class="px-4 py-2 rounded-lg text-white hover:opacity-90" style="background-color: var(--ui-accent);" onclick={save}>Save</button>
      </div>
    </div>
  </div>
</div>
