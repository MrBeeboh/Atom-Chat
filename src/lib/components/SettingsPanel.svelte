<script>
  import { fly } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import { globalDefault, updateGlobalDefault, selectedModelId, models, presetDefaultModels, lmStudioBaseUrl, voiceServerUrl, micDeviceId, lmStudioUnloadHelperUrl, localModelDirs, deepSeekApiKey, grokApiKey, cerebrasApiKey, togetherApiKey, deepinfraApiKey, braveApiKey, settingsFocus, ttsEngine, ttsKokoroVoice, ttsVoiceUri, ttsRate, ttsVolume } from '$lib/stores.js';
  import { refreshConnectionAndModels } from '$lib/connectionSetup.js';
  import { syncBraveKeyToProxy } from '$lib/duckduckgo.js';
  import { modelSelectorPrimaryLine, invalidateCloudModelCache } from '$lib/api.js';
  import { groupModelsForSelector } from '$lib/modelGroups.js';
  import { KOKORO_VOICES, listBrowserVoices, plainTextForSpeech, speakPlainText, stopTts, browserTtsSupported, warmUpKokoroTts, unlockAudioPlayback } from '$lib/tts.js';
  import { enumerateAudioInputs, requestMicPermissionForLabels } from '$lib/micAccess.js';
  import { onMount } from 'svelte';

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

  let connectionDetailsEl = $state(/** @type {HTMLDetailsElement | null} */ (null));
  let apiDetailsEl = $state(/** @type {HTMLDetailsElement | null} */ (null));
  let readAloudDetailsEl = $state(/** @type {HTMLDetailsElement | null} */ (null));
  let readAloudOpen = $state(false);
  /** @type {Array<{ deviceId: string, label: string }>} */
  let audioInputs = $state([]);
  let micDevicesLoading = $state(false);

  async function refreshMicDevices() {
    micDevicesLoading = true;
    try {
      audioInputs = await enumerateAudioInputs();
      const needsLabels = audioInputs.length > 0 && audioInputs.every((d) => /^Microphone \d+$/.test(d.label));
      if (needsLabels) {
        await requestMicPermissionForLabels();
        audioInputs = await enumerateAudioInputs();
      }
    } finally {
      micDevicesLoading = false;
    }
  }

  onMount(() => {
    refreshMicDevices();
  });
  let ttsTesting = $state(false);
  let ttsVoices = $state(/** @type {SpeechSynthesisVoice[]} */ ([]));

  const hasDeepinfraForTts = $derived(!!($deepinfraApiKey?.trim() || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEEPINFRA_API_KEY)));

  async function testReadAloudVoice() {
    if (ttsTesting) return;
    ttsTesting = true;
    unlockAudioPlayback();
    stopTts();
    if ($ttsEngine === 'kokoro' && hasDeepinfraForTts) await warmUpKokoroTts();
    try {
      await speakPlainText(
        plainTextForSpeech('This is the read aloud voice for chat messages.'),
        {
          voiceUri: $ttsVoiceUri,
          kokoroVoice: $ttsKokoroVoice,
          rate: $ttsRate,
          engine: $ttsEngine,
          onEnd: () => { ttsTesting = false; },
          onError: () => { ttsTesting = false; },
        },
      );
      if ($ttsEngine !== 'kokoro') ttsTesting = false;
    } catch {
      ttsTesting = false;
    }
  }

  $effect(() => {
    if (typeof window === 'undefined' || !browserTtsSupported()) return;
    const load = () => {
      ttsVoices = listBrowserVoices()
        .filter((v) => v.lang?.toLowerCase().startsWith('en') || !v.lang)
        .sort((a, b) => a.name.localeCompare(b.name));
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  });

  $effect(() => {
    const focus = $settingsFocus;
    if (!focus) return;
    if (focus === 'connection' && connectionDetailsEl) {
      connectionDetailsEl.open = true;
      connectionDetailsEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const input = connectionDetailsEl.querySelector('#settings-lmstudio-url');
      if (input instanceof HTMLInputElement) input.focus();
    }
    if (focus === 'api-keys' && apiDetailsEl) {
      apiDetailsEl.open = true;
      apiDetailsEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const input = apiDetailsEl.querySelector('#settings-deepseek-key');
      if (input instanceof HTMLInputElement) input.focus();
    }
    if (focus === 'read-aloud' && readAloudDetailsEl) {
      readAloudOpen = true;
      readAloudDetailsEl.open = true;
      readAloudDetailsEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (focus === 'microphone' && connectionDetailsEl) {
      connectionDetailsEl.open = true;
      connectionDetailsEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      refreshMicDevices();
      const select = connectionDetailsEl.querySelector('#settings-mic-device');
      if (select instanceof HTMLSelectElement) select.focus();
    }
    settingsFocus.set(null);
  });

  async function onApiKeyBlur() {
    invalidateCloudModelCache();
    await refreshConnectionAndModels();
  }
</script>

<div
  class="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
  role="dialog"
  aria-modal="true"
  aria-label="Settings">
  <div
    class="rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
    style="background-color: var(--ui-bg-main); border: 1px solid var(--ui-border);"
    in:fly={{ x: 300, duration: 400, easing: backOut }}
    out:fly={{ x: 300, duration: 300, easing: quintOut }}>
    <div class="shrink-0 px-6 pt-5 pb-4 flex items-start justify-between gap-2" style="border-bottom: 1px solid var(--ui-border);">
      <div>
        <h2 class="text-base font-semibold" style="color: var(--ui-text-primary);">Settings</h2>
        <p class="text-xs mt-0.5" style="color: var(--ui-text-secondary);">Connection &amp; API keys. Model/load settings are in the Intel panel (right).</p>
      </div>
      <button type="button" class="shrink-0 p-1.5 rounded-lg text-xl leading-none transition-colors" style="color: var(--ui-text-secondary);" onmouseenter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--ui-border) 40%, transparent)'; e.currentTarget.style.color = 'var(--ui-text-primary)'; }} onmouseleave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ui-text-secondary)'; }} onclick={() => onclose?.()} title="Close" aria-label="Close">✕</button>
    </div>
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-3">

      <details bind:this={connectionDetailsEl} class="rounded-lg overflow-hidden group" style="border: 1px solid var(--ui-border);" open>
        <summary class="px-4 py-3 cursor-pointer list-none text-sm font-medium transition-colors" style="background-color: var(--ui-bg-sidebar); border-bottom: 1px solid var(--ui-border); color: var(--ui-text-primary);">Connection</summary>
        <div class="px-4 py-3 space-y-3" style="background-color: var(--ui-bg-main);">
          <div>
            <label for="settings-lmstudio-url" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Backend URL (llama.cpp / LM Studio)</label>
            <input id="settings-lmstudio-url" type="url" bind:value={$lmStudioBaseUrl} onblur={onApiKeyBlur} placeholder="http://localhost:8080" class="w-full rounded-lg px-3 py-2 text-sm font-mono" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);" />
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);">Empty = localhost:8080 (llama.cpp). Use http://localhost:1234 for LM Studio. Enable CORS in LM Studio → Developer.</p>
            <p class="text-xs mt-2 rounded-md px-2 py-1.5" style="color: var(--ui-text-secondary); background: color-mix(in srgb, var(--ui-border) 35%, transparent);">API keys and this URL are saved per browser origin (same host and port). Using another port or switching localhost vs 127.0.0.1 looks like empty settings; use one consistent URL or paste keys again.</p>
          </div>
          <div>
            <label for="settings-unload-helper-url" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Unload helper URL</label>
            <input id="settings-unload-helper-url" type="url" bind:value={$lmStudioUnloadHelperUrl} placeholder="http://localhost:8766" class="w-full rounded-lg px-3 py-2 text-sm font-mono" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);" />
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);">Optional. <code style="background: color-mix(in srgb, var(--ui-border) 40%, transparent); padding: 0 4px; border-radius: 3px;">python scripts/unload_helper_server.py</code>. Leave empty to disable.</p>
          </div>
          <div>
            <label for="settings-voice-url" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Voice server URL</label>
            <input id="settings-voice-url" type="url" bind:value={$voiceServerUrl} placeholder="http://localhost:8765" class="w-full rounded-lg px-3 py-2 text-sm font-mono" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);" />
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);">Mic/voice. Default port 8765; see voice-server/README.</p>
          </div>
          <div>
            <div class="flex items-center justify-between gap-2 mb-1">
              <label for="settings-mic-device" class="block text-xs font-medium" style="color: var(--ui-text-secondary);">Microphone</label>
              <button
                type="button"
                class="text-xs px-2 py-0.5 rounded-md"
                style="color: var(--ui-accent); border: 1px solid color-mix(in srgb, var(--ui-accent) 35%, transparent);"
                disabled={micDevicesLoading}
                onclick={refreshMicDevices}
              >
                {micDevicesLoading ? 'Scanning…' : 'Refresh'}
              </button>
            </div>
            <select
              id="settings-mic-device"
              bind:value={$micDeviceId}
              class="w-full rounded-lg px-3 py-2 text-sm"
              style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);"
            >
              <option value="">System default</option>
              {#each audioInputs as dev (dev.deviceId)}
                <option value={dev.deviceId}>{dev.label}</option>
              {/each}
            </select>
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);">
              {#if audioInputs.length === 0 && !micDevicesLoading}
                No microphones detected. Plug one in and click Refresh, or check OS sound settings.
              {:else}
                Pick the mic ATOM should use for Talk and Dictate. If you see “device not found”, try another input here.
              {/if}
            </p>
          </div>
          <div>
            <label for="settings-local-model-dirs" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Extra GGUF folders</label>
            <textarea id="settings-local-model-dirs" rows="3" bind:value={$localModelDirs} onblur={onApiKeyBlur} placeholder="/home/you/extra-models" class="w-full rounded-lg px-3 py-2 text-sm font-mono" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);"></textarea>
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);">One absolute path per line. ATOM already scans ~/.lmstudio/models, ~/models, ~/.cache/llama.cpp, and ~/Downloads.</p>
          </div>
        </div>
      </details>

      <details bind:this={apiDetailsEl} class="rounded-lg overflow-hidden group" style="border: 1px solid var(--ui-border);">
        <summary class="px-4 py-3 cursor-pointer list-none text-sm font-medium transition-colors" style="background-color: var(--ui-bg-sidebar); border-bottom: 1px solid var(--ui-border); color: var(--ui-text-primary);">API keys</summary>
        <div class="px-4 py-3 space-y-4" style="background-color: var(--ui-bg-main);">
          <p class="text-xs" style="color: var(--ui-text-secondary);">Keys live in the browser for this site (host + port). With a key set, ATOM asks that provider for its current model list (Grok, DeepSeek, Cerebras, DeepInfra) instead of a short built-in catalog. You can also put keys in <code style="background: color-mix(in srgb, var(--ui-border) 40%, transparent); padding: 0 4px; border-radius: 3px;">.env.local</code> as <code style="background: color-mix(in srgb, var(--ui-border) 40%, transparent); padding: 0 4px; border-radius: 3px;">VITE_*</code> (see <code style="background: color-mix(in srgb, var(--ui-border) 40%, transparent); padding: 0 4px; border-radius: 3px;">.env.example</code>); they apply when storage is empty and copy into the browser on load. Restart <code style="background: color-mix(in srgb, var(--ui-border) 40%, transparent); padding: 0 4px; border-radius: 3px;">npm run dev</code> after editing env.</p>
          <div>
            <label for="settings-deepseek-key" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">DeepSeek API key</label>
            <input id="settings-deepseek-key" type="password" autocomplete="off" bind:value={$deepSeekApiKey} onblur={onApiKeyBlur} placeholder="API key (paste without extra spaces)" class="w-full rounded-lg px-3 py-2 text-sm font-mono" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);" />
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);"><a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer" style="color: var(--ui-accent);">platform.deepseek.com</a></p>
          </div>
          <div>
            <label for="settings-grok-key" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Grok (xAI) API key</label>
            <input id="settings-grok-key" type="password" autocomplete="off" bind:value={$grokApiKey} onblur={onApiKeyBlur} placeholder="xai-…" class="w-full rounded-lg px-3 py-2 text-sm font-mono" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);" />
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);"><a href="https://console.x.ai" target="_blank" rel="noopener noreferrer" style="color: var(--ui-accent);">console.x.ai</a></p>
          </div>
          <div>
            <label for="settings-cerebras-key" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Cerebras API key</label>
            <input id="settings-cerebras-key" type="password" autocomplete="off" bind:value={$cerebrasApiKey} onblur={onApiKeyBlur} placeholder="csk-…" class="w-full rounded-lg px-3 py-2 text-sm font-mono" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);" />
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);"><a href="https://cloud.cerebras.ai" target="_blank" rel="noopener noreferrer" style="color: var(--ui-accent);">cloud.cerebras.ai</a></p>
          </div>
          <div>
            <label for="settings-brave-key" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Brave Search API key (web search)</label>
            <input id="settings-brave-key" type="password" autocomplete="off" bind:value={$braveApiKey} onblur={() => syncBraveKeyToProxy($braveApiKey)} placeholder="Paste your Brave Search API key" class="w-full rounded-lg px-3 py-2 text-sm font-mono" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);" />
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);"><a href="https://search.brave.com/help/api" target="_blank" rel="noopener noreferrer" style="color: var(--ui-accent);">search.brave.com/help/api</a></p>
          </div>
          <div>
            <label for="settings-deepinfra-key" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">DeepInfra API key (image, video, Kokoro TTS)</label>
            <input id="settings-deepinfra-key" type="password" autocomplete="off" bind:value={$deepinfraApiKey} placeholder="…" class="w-full rounded-lg px-3 py-2 text-sm font-mono" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);" />
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);"><a href="https://deepinfra.com" target="_blank" rel="noopener noreferrer" style="color: var(--ui-accent);">deepinfra.com</a></p>
          </div>
          <div>
            <label for="settings-together-key" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Together AI API key (legacy image)</label>
            <input id="settings-together-key" type="password" autocomplete="off" bind:value={$togetherApiKey} placeholder="…" class="w-full rounded-lg px-3 py-2 text-sm font-mono" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);" />
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);"><a href="https://api.together.xyz" target="_blank" rel="noopener noreferrer" style="color: var(--ui-accent);">api.together.xyz</a></p>
          </div>
        </div>
      </details>

      <details id="settings-section-read-aloud" bind:this={readAloudDetailsEl} class="rounded-lg overflow-hidden group" style="border: 1px solid var(--ui-border);" bind:open={readAloudOpen}>
        <summary class="px-4 py-3 cursor-pointer list-none text-sm font-medium transition-colors" style="background-color: var(--ui-bg-sidebar); border-bottom: 1px solid var(--ui-border); color: var(--ui-text-primary);">Read aloud (TTS)</summary>
        <div class="px-4 py-3 space-y-3" style="background-color: var(--ui-bg-main);">
          <p class="text-xs" style="color: var(--ui-text-secondary);">Use the <strong style="color: var(--ui-text-primary); font-weight: 600;">speaker icon</strong> in the chat bar. Open mic turns it on automatically. Shift+click the speaker to jump here.</p>
          {#if !hasDeepinfraForTts}
            <p class="text-xs rounded-md px-2.5 py-2" style="color: var(--ui-text-primary); background: color-mix(in srgb, #eab308 14%, transparent);">Add your <strong>DeepInfra API key</strong> above for natural Kokoro TTS. Browser voice still works without it.</p>
          {/if}
          <label for="settings-tts-engine" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Engine</label>
          <select id="settings-tts-engine" bind:value={$ttsEngine} class="w-full rounded-lg px-3 py-2 text-sm" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);">
            <option value="kokoro" disabled={!hasDeepinfraForTts}>Kokoro (DeepInfra) — natural voice{hasDeepinfraForTts ? '' : ' — needs DeepInfra key'}</option>
            <option value="browser">Browser — robotic fallback</option>
          </select>
          {#if $ttsEngine === 'kokoro' && hasDeepinfraForTts}
            <label for="settings-kokoro-voice" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Kokoro voice</label>
            <select id="settings-kokoro-voice" bind:value={$ttsKokoroVoice} class="w-full rounded-lg px-3 py-2 text-sm" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);">
              {#each KOKORO_VOICES as v (v.id)}
                <option value={v.id}>{v.label}</option>
              {/each}
            </select>
          {:else if browserTtsSupported()}
            <label for="settings-tts-voice" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Browser voice</label>
            <select id="settings-tts-voice" bind:value={$ttsVoiceUri} class="w-full rounded-lg px-3 py-2 text-sm" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);">
              <option value="">System default (English)</option>
              {#each ttsVoices as v (v.voiceURI)}
                <option value={v.voiceURI}>{v.name}{v.localService ? ' · local' : ''} ({v.lang})</option>
              {/each}
            </select>
          {/if}
          <label for="settings-tts-rate" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Speech rate ({($ttsRate ?? 1).toFixed(2)}×)</label>
          <input id="settings-tts-rate" type="range" min="0.75" max="1.35" step="0.05" bind:value={$ttsRate} class="w-full h-2 rounded-full accent-themed" />
          <label for="settings-tts-volume" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">ATOM volume ({Math.round(($ttsVolume ?? 0.8) * 100)}%) — does not change system volume</label>
          <input id="settings-tts-volume" type="range" min="0" max="1" step="0.01" bind:value={$ttsVolume} class="w-full h-2 rounded-full accent-themed" />
          <button type="button" class="text-xs px-2.5 py-1.5 rounded-lg font-medium" style="border: 1px solid var(--ui-border); color: var(--ui-text-primary);" disabled={ttsTesting} onclick={testReadAloudVoice}>{ttsTesting ? 'Playing…' : 'Test read aloud voice'}</button>
        </div>
      </details>

      <details class="rounded-lg overflow-hidden group" style="border: 1px solid var(--ui-border);">
        <summary class="px-4 py-3 cursor-pointer list-none text-sm font-medium transition-colors" style="background-color: var(--ui-bg-sidebar); border-bottom: 1px solid var(--ui-border); color: var(--ui-text-primary);">Audio</summary>
        <div class="px-4 py-3 space-y-3" style="background-color: var(--ui-bg-main);">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={audioEnabled} class="rounded accent-themed" />
            <span class="text-sm" style="color: var(--ui-text-primary);">Enable audio feedback</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={audioClicks} disabled={!audioEnabled} class="rounded accent-themed" />
            <span class="text-sm" style="color: var(--ui-text-primary);">Click sounds</span>
          </label>
          <div>
            <label for="settings-audio-volume" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Volume</label>
            <input id="settings-audio-volume" type="range" min="0" max="1" step="0.05" bind:value={audioVolume} disabled={!audioEnabled} class="w-full h-2 rounded-full accent-themed" />
          </div>
        </div>
      </details>

      <details class="rounded-lg overflow-hidden group" style="border: 1px solid var(--ui-border);">
        <summary class="px-4 py-3 cursor-pointer list-none text-sm font-medium transition-colors" style="background-color: var(--ui-bg-sidebar); border-bottom: 1px solid var(--ui-border); color: var(--ui-text-primary);">Preset default models</summary>
        <div class="px-4 py-3" style="background-color: var(--ui-bg-main);">
          <p class="text-xs mb-3" style="color: var(--ui-text-secondary);">Model to switch to when selecting a preset from the header.</p>
          <div class="space-y-2">
            {#each PRESETS as p}
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs min-w-[4rem]" style="color: var(--ui-text-secondary);">{p.name}:</span>
                <select class="text-xs rounded-lg px-2 py-1 min-w-[140px]" style="border: 1px solid var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);" value={$presetDefaultModels[p.name] ?? ''} onchange={(e) => setPresetDefaultModel(p.name, e.currentTarget.value || null)} aria-label="Default model for {p.name}">
                  <option value="">None</option>
                  {#each groupModelsForSelector($models) as g}
                    <optgroup label={g.title}>
                      {#each g.items as m (m.id)}
                        <option value={m.id}>{modelSelectorPrimaryLine(m.id)}</option>
                      {/each}
                    </optgroup>
                  {/each}
                </select>
              </div>
            {/each}
          </div>
        </div>
      </details>

    </div>
    <div class="shrink-0 px-6 py-4 flex justify-between gap-2" style="border-top: 1px solid var(--ui-border);">
      <button type="button" class="px-3 py-1.5 text-sm rounded-lg transition-colors" style="border: 1px solid var(--ui-border); color: var(--ui-text-secondary);" onmouseenter={(e) => e.currentTarget.style.background = 'color-mix(in srgb, var(--ui-border) 40%, transparent)'} onmouseleave={(e) => e.currentTarget.style.background = 'transparent'} onclick={resetToDefaults}>Reset to defaults</button>
      <div class="flex gap-2">
        <button type="button" class="px-4 py-2 rounded-lg text-sm transition-colors" style="border: 1px solid var(--ui-border); color: var(--ui-text-secondary);" onmouseenter={(e) => e.currentTarget.style.background = 'color-mix(in srgb, var(--ui-border) 40%, transparent)'} onmouseleave={(e) => e.currentTarget.style.background = 'transparent'} onclick={() => onclose?.()}>Cancel</button>
        <button type="button" class="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90" style="background-color: var(--ui-accent); color: var(--ui-bg-main);" onclick={save}>Save</button>
      </div>
    </div>
  </div>
</div>
