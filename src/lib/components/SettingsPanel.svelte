<script>
  import { fly } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import { settings, layout, globalDefault, updateGlobalDefault, selectedModelId, hardware, models, presetDefaultModels, lmStudioBaseUrl, voiceServerUrl } from '$lib/stores.js';
  import { loadModel } from '$lib/api.js';
  import { getDefaultsForModel, BATCH_SIZE_MIN, BATCH_SIZE_MAX } from '$lib/modelDefaults.js';

  let { onclose } = $props();

  const DEFAULTS = {
    temperature: 0.7,
    max_tokens: 4096,
    system_prompt: 'You are a helpful assistant.',
    top_p: 0.95,
    top_k: 64,
    repeat_penalty: 1.15,
    stop: [],
    model_ttl_seconds: 0,
    audio_enabled: true,
    audio_clicks: true,
    audio_volume: 0.25,
    context_length: 4096,
    eval_batch_size: 512,
    flash_attention: true,
    offload_kv_cache_to_gpu: true,
    gpu_offload: 'max',
    cpu_threads: 4,
  };

  const GPU_OFFLOAD_OPTIONS = [
    { value: 'max', label: 'Max (recommended)' },
    { value: '1', label: '100%' },
    { value: '0.75', label: '75%' },
    { value: '0.5', label: '50%' },
    { value: '0.25', label: '25%' },
    { value: 'off', label: 'Off (CPU only)' },
  ];

  let temp = $state(DEFAULTS.temperature);
  let maxTok = $state(DEFAULTS.max_tokens);
  let sysPrompt = $state(DEFAULTS.system_prompt);
  let topP = $state(DEFAULTS.top_p);
  let topK = $state(DEFAULTS.top_k);
  let repeatPenalty = $state(DEFAULTS.repeat_penalty);
  let stopStrings = $state([]);
  let modelTtlSeconds = $state(DEFAULTS.model_ttl_seconds);
  let audioEnabled = $state(DEFAULTS.audio_enabled);
  let audioClicks = $state(DEFAULTS.audio_clicks);
  let audioVolume = $state(DEFAULTS.audio_volume);
  let contextLength = $state(DEFAULTS.context_length);
  let evalBatchSize = $state(DEFAULTS.eval_batch_size);
  let flashAttention = $state(DEFAULTS.flash_attention);
  let offloadKvToGpu = $state(DEFAULTS.offload_kv_cache_to_gpu);
  let gpuOffload = $state(DEFAULTS.gpu_offload);
  let cpuThreads = $state(DEFAULTS.cpu_threads);

  $effect(() => {
    const g = $globalDefault;
    $layout;
    temp = g.temperature ?? DEFAULTS.temperature;
    maxTok = g.max_tokens ?? DEFAULTS.max_tokens;
    sysPrompt = g.system_prompt ?? DEFAULTS.system_prompt;
    topP = g.top_p ?? DEFAULTS.top_p;
    topK = g.top_k ?? DEFAULTS.top_k;
    repeatPenalty = g.repeat_penalty ?? DEFAULTS.repeat_penalty;
    stopStrings = Array.isArray(g.stop) ? [...g.stop] : [];
    modelTtlSeconds = g.model_ttl_seconds ?? DEFAULTS.model_ttl_seconds;
    audioEnabled = g.audio_enabled ?? DEFAULTS.audio_enabled;
    audioClicks = g.audio_clicks ?? DEFAULTS.audio_clicks;
    audioVolume = g.audio_volume ?? DEFAULTS.audio_volume;
    contextLength = g.context_length ?? DEFAULTS.context_length;
    evalBatchSize = g.eval_batch_size ?? DEFAULTS.eval_batch_size;
    flashAttention = g.flash_attention ?? DEFAULTS.flash_attention;
    offloadKvToGpu = g.offload_kv_cache_to_gpu ?? DEFAULTS.offload_kv_cache_to_gpu;
    gpuOffload = g.gpu_offload ?? DEFAULTS.gpu_offload;
    cpuThreads = g.cpu_threads ?? DEFAULTS.cpu_threads;
  });

  const maxCpuThreads = $derived(Math.max(1, $hardware?.cpuLogicalCores ?? 4));

  let stopInput = $state('');
  let loadSectionOpen = $state(true);
  let settingsOpen = $state(true);
  let samplingOpen = $state(true);
  let loadError = $state(null);
  let loadApplying = $state(false);

  const PRESETS = [
    { name: 'General', prompt: 'You are a helpful assistant.' },
    { name: 'Code', prompt: 'You are an expert programmer. Be concise. Prefer code over prose when relevant.' },
    { name: 'Research', prompt: 'You are a thorough researcher. Cite sources when possible. Structure answers with clear sections.' },
    { name: 'Creative', prompt: 'You are a creative writer. Use vivid language and varied structure. Be engaging and original.' },
  ];

  function applyPreset(preset) {
    sysPrompt = preset.prompt;
    const defaultModel = $presetDefaultModels[preset.name];
    if (defaultModel && $models.some((m) => m.id === defaultModel)) {
      selectedModelId.set(defaultModel);
    }
    updateGlobalDefault({ system_prompt: preset.prompt });
  }

  function setPresetDefaultModel(presetName, modelId) {
    presetDefaultModels.update((m) => {
      const next = { ...m };
      if (modelId) next[presetName] = modelId;
      else delete next[presetName];
      return next;
    });
    if (modelId) selectedModelId.set(modelId);
  }

  function addStop() {
    const s = stopInput.trim();
    if (s && !stopStrings.includes(s)) {
      stopStrings = [...stopStrings, s];
      stopInput = '';
    }
  }

  function removeStop(i) {
    stopStrings = stopStrings.filter((_, idx) => idx !== i);
  }

  function onStopKeydown(ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      addStop();
    }
  }

  /** Rough token estimate (~4 chars per token) */
  const systemPromptTokens = $derived(Math.max(0, Math.ceil((sysPrompt?.length ?? 0) / 4)));

  const MAX_TOKENS_MIN = 128;
  const MAX_TOKENS_MAX = 131072;

  function stepMaxTokDown() {
    const next = Math.max(MAX_TOKENS_MIN, Math.round(maxTok / 2));
    maxTok = next;
  }

  function stepMaxTokUp() {
    const next = Math.min(MAX_TOKENS_MAX, Math.round(maxTok * 2));
    maxTok = next;
  }

  function stepBatchDown() {
    evalBatchSize = Math.max(BATCH_SIZE_MIN, Math.round(evalBatchSize / 2));
  }
  function stepBatchUp() {
    evalBatchSize = Math.min(BATCH_SIZE_MAX, Math.round(evalBatchSize * 2));
  }

  async function applyLoadToModel() {
    if (!$selectedModelId) {
      loadError = 'No model selected. Select a model first.';
      return;
    }
    loadError = null;
    loadApplying = true;
    try {
      await loadModel($selectedModelId, {
        context_length: contextLength,
        eval_batch_size: evalBatchSize,
        flash_attention: flashAttention,
        offload_kv_cache_to_gpu: offloadKvToGpu,
        gpu_offload: gpuOffload,
        cpu_threads: Math.min(maxCpuThreads, Math.max(1, cpuThreads)),
      });
      updateGlobalDefault({
        context_length: contextLength,
        eval_batch_size: evalBatchSize,
        flash_attention: flashAttention,
        offload_kv_cache_to_gpu: offloadKvToGpu,
        gpu_offload: gpuOffload,
        cpu_threads: cpuThreads,
      });
    } catch (e) {
      loadError = e?.message || 'Failed to apply load settings. Is LM Studio running?';
    } finally {
      loadApplying = false;
    }
  }

  function save() {
    updateGlobalDefault({
      temperature: temp,
      max_tokens: maxTok,
      system_prompt: sysPrompt,
      top_p: topP,
      top_k: topK,
      repeat_penalty: repeatPenalty,
      stop: stopStrings,
      model_ttl_seconds: Math.max(0, Number(modelTtlSeconds) || 0),
      audio_enabled: !!audioEnabled,
      audio_clicks: !!audioClicks,
      audio_volume: Math.max(0, Math.min(1, Number(audioVolume) || 0)),
      context_length: contextLength,
      eval_batch_size: evalBatchSize,
      flash_attention: flashAttention,
      offload_kv_cache_to_gpu: offloadKvToGpu,
      gpu_offload: gpuOffload,
      cpu_threads: Math.min(maxCpuThreads, Math.max(1, cpuThreads)),
    });
    onclose?.();
  }

  function resetToDefaults() {
    const modelId = $selectedModelId;
    const hw = $hardware;
    const d = modelId ? getDefaultsForModel(modelId, hw) : DEFAULTS;
    temp = d.temperature ?? DEFAULTS.temperature;
    maxTok = d.max_tokens ?? DEFAULTS.max_tokens;
    sysPrompt = DEFAULTS.system_prompt;
    topP = d.top_p ?? DEFAULTS.top_p;
    topK = d.top_k ?? DEFAULTS.top_k;
    repeatPenalty = d.repeat_penalty ?? DEFAULTS.repeat_penalty;
    stopStrings = [];
    modelTtlSeconds = d.model_ttl_seconds ?? DEFAULTS.model_ttl_seconds;
    audioEnabled = d.audio_enabled ?? DEFAULTS.audio_enabled;
    audioClicks = d.audio_clicks ?? DEFAULTS.audio_clicks;
    audioVolume = d.audio_volume ?? DEFAULTS.audio_volume;
    contextLength = d.context_length ?? DEFAULTS.context_length;
    evalBatchSize = d.eval_batch_size ?? DEFAULTS.eval_batch_size;
    flashAttention = d.flash_attention ?? DEFAULTS.flash_attention;
    offloadKvToGpu = d.offload_kv_cache_to_gpu ?? DEFAULTS.offload_kv_cache_to_gpu;
    gpuOffload = d.gpu_offload ?? DEFAULTS.gpu_offload;
    cpuThreads = Math.min(maxCpuThreads, d.cpu_threads ?? maxCpuThreads);
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
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Global default for all models. To set options for one model only, use the Intel panel (right) and click <strong>Save for this model</strong>.</p>
      </div>
      <button type="button" class="shrink-0 p-1.5 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 text-xl leading-none" onclick={() => onclose?.()} title="Close" aria-label="Close">✕</button>
    </div>
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      <!-- LM Studio server URL -->
      <div class="border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden">
        <div class="px-4 py-3 border-b border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/80">
          <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">LM Studio server</span>
        </div>
        <div class="px-4 py-3 space-y-1">
          <label for="settings-lmstudio-url" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400">Server URL</label>
          <input
            id="settings-lmstudio-url"
            type="url"
            bind:value={$lmStudioBaseUrl}
            placeholder="http://localhost:1234"
            class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm font-mono placeholder:text-zinc-400" />
          <p class="text-xs text-zinc-500 dark:text-zinc-400">Leave empty for default (localhost:1234). Use your LM Studio “Reachable at” URL, e.g. <code class="bg-zinc-200 dark:bg-zinc-700 px-1 rounded">http://10.0.0.51:1234</code>. Enable CORS in LM Studio → Developer → Server Settings.</p>
        </div>
      </div>

      <!-- Voice-to-text server URL (insanely-fast-whisper backend) -->
      <div class="border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden">
        <div class="px-4 py-3 border-b border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/80">
          <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">Voice-to-text server</span>
        </div>
        <div class="px-4 py-3 space-y-1">
          <label for="settings-voice-url" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400">Server URL</label>
          <input
            id="settings-voice-url"
            type="url"
            bind:value={$voiceServerUrl}
            placeholder="http://localhost:8765"
            class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm font-mono placeholder:text-zinc-400" />
          <p class="text-xs text-zinc-500 dark:text-zinc-400">Run the Python voice server from the <code class="bg-zinc-200 dark:bg-zinc-700 px-1 rounded">voice-server</code> folder (see <code class="bg-zinc-200 dark:bg-zinc-700 px-1 rounded">voice-server/README.md</code>). Leave default to use mic with local server at port 8765.</p>
        </div>
      </div>

      <!-- Load settings (batch size, context – applied when loading model) -->
      <div class="border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors"
          onclick={() => (loadSectionOpen = !loadSectionOpen)}>
          <span class="text-zinc-500">📦</span>
          Load settings
          <span class="ml-auto text-zinc-400">{loadSectionOpen ? '▼' : '▶'}</span>
        </button>
        {#if loadSectionOpen}
          <div class="px-4 pb-4 pt-1 space-y-4 border-t border-zinc-200 dark:border-zinc-600">
            <p class="text-xs text-zinc-500 dark:text-zinc-400">Applied when you click “Apply to model”. Affects speed and memory.</p>
            <div>
              <label for="settings-context-length" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Context length</label>
              <input
                id="settings-context-length"
                type="number"
                min="512"
                max="131072"
                step="256"
                bind:value={contextLength}
                class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm" />
            </div>
            <div>
              <label for="settings-batch-size" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Batch size</label>
              <div class="flex items-stretch gap-1">
                <input
                  id="settings-batch-size"
                  type="number"
                  min={BATCH_SIZE_MIN}
                  max={BATCH_SIZE_MAX}
                  bind:value={evalBatchSize}
                  onfocus={(e) => e.target.select()}
                  class="batch-size-step-input flex-1 rounded-l border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm min-w-0" />
                <div class="flex flex-col border border-l-0 border-zinc-300 dark:border-zinc-600 rounded-r overflow-hidden">
                  <button type="button" class="flex-1 px-2 py-0.5 border-b border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-xs font-medium transition-colors" onclick={stepBatchUp} title="Double" aria-label="Double batch size">▲</button>
                  <button type="button" class="flex-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-xs font-medium transition-colors" onclick={stepBatchDown} title="Half" aria-label="Halve batch size">▼</button>
                </div>
              </div>
              <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Type a number or use ▲/▼ to double or half ({BATCH_SIZE_MIN} – {BATCH_SIZE_MAX})</p>
            </div>
            <div>
              <label for="settings-gpu-offload" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">GPU offload</label>
              <select
                id="settings-gpu-offload"
                bind:value={gpuOffload}
                class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm">
                {#each GPU_OFFLOAD_OPTIONS as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
              <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">How much of the model to run on GPU (LM Studio –gpu).</p>
            </div>
            <div>
              <label for="settings-model-ttl" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Idle TTL (seconds)</label>
              <input
                id="settings-model-ttl"
                type="number"
                min="0"
                step="60"
                bind:value={modelTtlSeconds}
                class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm" />
              <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">0 disables. Works with LM Studio JIT + Auto‑Evict to free VRAM when idle.</p>
            </div>
            <div>
              <label for="settings-cpu-threads" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">CPU threads</label>
              <input
                id="settings-cpu-threads"
                type="number"
                min="1"
                max={maxCpuThreads}
                bind:value={cpuThreads}
                class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm" />
              <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">System: {maxCpuThreads} logical cores. Use up to this for best throughput.</p>
            </div>
            <div class="flex items-center gap-4">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" bind:checked={flashAttention} class="rounded border-zinc-300 dark:border-zinc-600 accent-themed" />
                <span class="text-sm text-zinc-700 dark:text-zinc-300">Flash attention</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" bind:checked={offloadKvToGpu} class="rounded border-zinc-300 dark:border-zinc-600 accent-themed" />
                <span class="text-sm text-zinc-700 dark:text-zinc-300">Offload KV cache to GPU</span>
              </label>
            </div>
            {#if loadError}
              <p class="text-sm text-red-600 dark:text-red-400">{loadError}</p>
            {/if}
            <button
              type="button"
              class="w-full px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
              onclick={applyLoadToModel}
              disabled={loadApplying || !$selectedModelId}>
              {loadApplying ? 'Applying…' : 'Apply to model'}
            </button>
          </div>
        {/if}
      </div>

      <!-- Audio feedback -->
      <div class="border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden">
        <div class="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/80">
          <span class="text-zinc-500">🔊</span>
          Audio feedback
        </div>
        <div class="px-4 pb-4 pt-3 space-y-3 border-t border-zinc-200 dark:border-zinc-600">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={audioEnabled} class="rounded border-zinc-300 dark:border-zinc-600 accent-themed" />
            <span class="text-sm text-zinc-700 dark:text-zinc-300">Enable audio feedback</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={audioClicks} disabled={!audioEnabled} class="rounded border-zinc-300 dark:border-zinc-600 accent-themed" />
            <span class="text-sm text-zinc-700 dark:text-zinc-300">Click sounds for actions</span>
          </label>
          <div>
            <label for="settings-audio-volume" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Volume</label>
            <input
              id="settings-audio-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={audioVolume}
              disabled={!audioEnabled}
              class="w-full h-2 rounded-full accent-themed" />
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">Send and completion tones are always enabled when audio is on.</p>
        </div>
      </div>

      <!-- Preset (each has optional default model) -->
      <div>
        <span class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Preset</span>
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Click a preset to apply its system prompt and default model. Set default model per preset below.</p>
        <div class="space-y-2">
          {#each PRESETS as p}
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
                onclick={() => applyPreset(p)}>{p.name}</button>
              <span class="text-xs text-zinc-500 dark:text-zinc-400">Default model:</span>
              <select
                class="text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-2 py-1 min-w-[140px]"
                value={$presetDefaultModels[p.name] ?? ''}
                onchange={(e) => setPresetDefaultModel(p.name, e.currentTarget.value || null)}
                aria-label="Default model for {p.name}">
                <option value="">None</option>
                {#each $models as m}
                  <option value={m.id}>{m.id}</option>
                {/each}
              </select>
            </div>
          {/each}
        </div>
      </div>

      <!-- System prompt -->
      <div>
        <label for="settings-system-prompt" class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">System prompt</label>
        <textarea
          id="settings-system-prompt"
          bind:value={sysPrompt}
          rows="5"
          class="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 resize-y text-sm"
          placeholder="You are a helpful assistant."></textarea>
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Token count (approx.): {systemPromptTokens}</p>
      </div>

      <!-- Settings (collapsible) -->
      <div class="border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors"
          onclick={() => (settingsOpen = !settingsOpen)}>
          <span class="text-zinc-500">⚙️</span>
          Settings
          <span class="ml-auto text-zinc-400">{settingsOpen ? '▼' : '▶'}</span>
        </button>
        {#if settingsOpen}
          <div class="px-4 pb-4 pt-1 space-y-4 border-t border-zinc-200 dark:border-zinc-600">
            <div>
              <label for="settings-temp" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Temperature</label>
              <div class="flex items-center gap-3">
                <input
                  id="settings-temp"
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  bind:value={temp}
                  class="flex-1 h-2 rounded-full accent-themed" />
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.05"
                  bind:value={temp}
                  class="w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100" />
              </div>
            </div>
            <div>
              <label for="settings-max-tokens" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Max tokens</label>
              <div class="flex items-stretch gap-1">
                <input
                  id="settings-max-tokens"
                  type="number"
                  min={MAX_TOKENS_MIN}
                  max={MAX_TOKENS_MAX}
                  bind:value={maxTok}
                  onfocus={(e) => e.target.select()}
                  class="max-tokens-step-input flex-1 rounded-l border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm min-w-0" />
                <div class="flex flex-col border border-l-0 border-zinc-300 dark:border-zinc-600 rounded-r overflow-hidden">
                  <button
                    type="button"
                    class="flex-1 px-2 py-0.5 border-b border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-xs font-medium transition-colors"
                    onclick={stepMaxTokUp}
                    title="Double (e.g. 2048 → 4096)"
                    aria-label="Double max tokens">▲</button>
                  <button
                    type="button"
                    class="flex-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-xs font-medium transition-colors"
                    onclick={stepMaxTokDown}
                    title="Half (e.g. 4096 → 2048)"
                    aria-label="Halve max tokens">▼</button>
                </div>
              </div>
              <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Type a number or use ▲/▼ to double or half (128 – 131072)</p>
            </div>
            <div>
              <label for="settings-stop" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Stop strings</label>
              <input
                id="settings-stop"
                type="text"
                bind:value={stopInput}
                onkeydown={onStopKeydown}
                placeholder="Enter a string and press Enter"
                class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400" />
              {#if stopStrings.length}
                <div class="flex flex-wrap gap-2 mt-2">
                  {#each stopStrings as s, i}
                    <span
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-200 dark:bg-zinc-600 text-zinc-800 dark:text-zinc-200 text-xs">
                      {s}
                      <button type="button" class="hover:text-red-600 dark:hover:text-red-400" onclick={() => removeStop(i)} aria-label="Remove">×</button>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <!-- Sampling (collapsible) -->
      <div class="border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors"
          onclick={() => (samplingOpen = !samplingOpen)}>
          <span class="text-zinc-500">○</span>
          Sampling
          <span class="ml-auto text-zinc-400">{samplingOpen ? '▼' : '▶'}</span>
        </button>
        {#if samplingOpen}
          <div class="px-4 pb-4 pt-1 space-y-4 border-t border-zinc-200 dark:border-zinc-600">
            <div>
              <label for="settings-top-k" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Top K</label>
              <input
                id="settings-top-k"
                type="number"
                min="1"
                max="200"
                bind:value={topK}
                class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm" />
            </div>
            <div>
              <label for="settings-top-p" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Top P</label>
              <div class="flex items-center gap-3">
                <input
                  id="settings-top-p"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  bind:value={topP}
                  class="flex-1 h-2 rounded-full accent-themed" />
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  bind:value={topP}
                  class="w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100" />
              </div>
            </div>
            <div>
              <label for="settings-repeat-penalty" class="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Repeat penalty</label>
              <input
                id="settings-repeat-penalty"
                type="number"
                min="1"
                max="2"
                step="0.01"
                bind:value={repeatPenalty}
                class="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm" />
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div class="shrink-0 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 flex justify-between gap-2">
      <button
        type="button"
        class="px-3 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400"
        onclick={resetToDefaults}>
        Reset to defaults
      </button>
      <div class="flex gap-2">
        <button
          type="button"
          class="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
          onclick={() => onclose?.()}>
          Cancel
        </button>
        <button
          type="button"
          class="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
          onclick={save}>
          Save
        </button>
      </div>
    </div>
  </div>
</div>
