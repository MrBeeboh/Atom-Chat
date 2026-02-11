<!--
  IntelPanel: right-hand cockpit panel. System prompt, model display, Parameters (temp/top_p/top_k/context),
  context usage bar, Load settings (batch, GPU, TTL, CPU thr, Parallel, Flash attn, KV→GPU), Optimize, Save.
  Optimize fetches recommended settings from Hugging Face (with AI fallback); Save applies and loads model via LM Studio.
-->
<script>
  import { get } from 'svelte/store';
  import {
    settings,
    selectedModelId,
    activeMessages,
    models,
    updateGlobalDefault,
    setPerModelOverride,
    hardware,
    settingsOpen,
    confirm,
  } from '$lib/stores.js';
  import { BATCH_SIZE_MIN, BATCH_SIZE_MAX } from '$lib/modelDefaults.js';
  import { getModelIcon, getQuantization, modelIconOverrides } from '$lib/modelIcons.js';
  import { loadModel } from '$lib/api.js';
  import { fetchOptimalSettingsWithDelay, askModelForOptimalSettings, resolveHfModelId, getHfModelUrl, getHfSearchUrl } from '$lib/hfOptimize.js';
  import InfoTooltip from '$lib/components/InfoTooltip.svelte';
  import ThinkingAtom from '$lib/components/ThinkingAtom.svelte';

  let settingsVal = $state({});
  let contextLength = $state(4096);
  let temperature = $state(0.7);
  let topP = $state(0.95);
  let topK = $state(64);
  let sysPrompt = $state('You are a helpful assistant.');
  let currentModelId = $state('');
  let messagesList = $state([]);

  $effect(() => {
    const unsubC = selectedModelId.subscribe((v) => (currentModelId = v ?? ''));
    return () => unsubC();
  });

  const DEFAULTS = {
    context_length: 4096,
    eval_batch_size: 512,
    flash_attention: true,
    offload_kv_cache_to_gpu: true,
    gpu_offload: 'max',
    cpu_threads: 4,
    n_parallel: 4,
    model_ttl_seconds: 0,
  };
  const GPU_OFFLOAD_OPTIONS = [
    { value: 'max', label: 'Max' },
    { value: '1', label: '100%' },
    { value: '0.75', label: '75%' },
    { value: '0.5', label: '50%' },
    { value: '0.25', label: '25%' },
    { value: 'off', label: 'Off' },
  ];

  let evalBatchSize = $state(DEFAULTS.eval_batch_size);
  let flashAttention = $state(DEFAULTS.flash_attention);
  let offloadKvToGpu = $state(DEFAULTS.offload_kv_cache_to_gpu);
  let gpuOffload = $state(DEFAULTS.gpu_offload);
  let cpuThreads = $state(DEFAULTS.cpu_threads);
  let nParallel = $state(DEFAULTS.n_parallel);
  let modelTtlSeconds = $state(DEFAULTS.model_ttl_seconds);
  let loadError = $state(null);
  let loadApplying = $state(false);
  let optimizeApplying = $state(false);
  let optimizeError = $state(null);
  let hfLookupResolving = $state(false);
  let modelCardReadme = $state(null);
  let modelCardExpanded = $state(false);

  const maxCpuThreads = $derived(Math.max(1, $hardware?.cpuLogicalCores ?? 4));

  $effect(() => {
    const unsub = settings.subscribe((s) => {
      settingsVal = s ?? {};
      contextLength = s?.context_length ?? 4096;
      evalBatchSize = s?.eval_batch_size ?? DEFAULTS.eval_batch_size;
      flashAttention = s?.flash_attention ?? DEFAULTS.flash_attention;
      offloadKvToGpu = s?.offload_kv_cache_to_gpu ?? DEFAULTS.offload_kv_cache_to_gpu;
      gpuOffload = s?.gpu_offload ?? DEFAULTS.gpu_offload;
      cpuThreads = s?.cpu_threads ?? DEFAULTS.cpu_threads;
      nParallel = s?.n_parallel ?? DEFAULTS.n_parallel;
      modelTtlSeconds = s?.model_ttl_seconds ?? DEFAULTS.model_ttl_seconds;
      temperature = s?.temperature ?? 0.7;
      topP = s?.top_p ?? 0.95;
      topK = s?.top_k ?? 64;
      sysPrompt = (s?.system_prompt ?? 'You are a helpful assistant.').toString();
    });
    return () => unsub();
  });

  $effect(() => {
    const unsub = activeMessages.subscribe((v) => (messagesList = v ?? []));
    return () => unsub();
  });

  const estimatedContextUsed = $derived(
    messagesList.reduce((acc, m) => {
      const text = typeof m.content === 'string' ? m.content : m.content?.find((p) => p.type === 'text')?.text ?? '';
      return acc + Math.ceil((text?.length ?? 0) / 4);
    }, 0)
  );
  const contextPercent = $derived(
    contextLength > 0 ? Math.min(100, Math.round((estimatedContextUsed / contextLength) * 100)) : 0
  );

  function onTempInput(e) {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) temperature = v;
  }
  function onTopPInput(e) {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) topP = v;
  }
  function onTopKInput(e) {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v)) topK = v;
  }
  function onContextInput(e) {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v)) contextLength = Math.max(512, Math.min(131072, v));
  }

  async function save() {
    if (!currentModelId) {
      loadError = 'Select a model first.';
      return;
    }
    loadError = null;
    loadApplying = true;
    try {
      const payload = {
        temperature,
        top_p: topP,
        top_k: topK,
        system_prompt: sysPrompt.trim() || undefined,
        context_length: contextLength,
        eval_batch_size: evalBatchSize,
        flash_attention: flashAttention,
        offload_kv_cache_to_gpu: offloadKvToGpu,
        gpu_offload: gpuOffload,
        cpu_threads: cpuThreads,
        n_parallel: nParallel,
        model_ttl_seconds: modelTtlSeconds,
      };
      setPerModelOverride(currentModelId, payload);
      updateGlobalDefault(payload);
      await loadModel(currentModelId, {
        context_length: contextLength,
        eval_batch_size: evalBatchSize,
        flash_attention: flashAttention,
        offload_kv_cache_to_gpu: offloadKvToGpu,
      });
    } catch (e) {
      loadError = e?.message || 'Failed. Is LM Studio running?';
    } finally {
      loadApplying = false;
    }
  }

  function stepBatchDown() {
    evalBatchSize = Math.max(BATCH_SIZE_MIN, Math.round(evalBatchSize / 2));
  }
  function stepBatchUp() {
    evalBatchSize = Math.min(BATCH_SIZE_MAX, Math.round(evalBatchSize * 2));
  }

  function openSettings() {
    settingsOpen.set(true);
  }

  async function openHfLookup() {
    if (!currentModelId) return;
    hfLookupResolving = true;
    try {
      const hfId = await resolveHfModelId(currentModelId);
      const url = hfId ? getHfModelUrl(hfId) : getHfSearchUrl(currentModelId);
      if (url) window.open(url, '_blank', 'noopener');
    } finally {
      hfLookupResolving = false;
    }
  }

  async function optimize() {
    if (!currentModelId) {
      optimizeError = 'Select a model first.';
      return;
    }
    optimizeError = null;
    modelCardReadme = null;
    modelCardExpanded = false;
    optimizeApplying = true;
    try {
      const { settings: optimal, prompt: optimalPrompt, source, readme, error } = await fetchOptimalSettingsWithDelay(currentModelId);
      if (readme) modelCardReadme = readme;
      if (error) {
        const useAi = await confirm({
          title: 'Ask AI for settings?',
          message: `${error} Ask your smartest loaded model for recommended settings instead?`,
          confirmLabel: 'Yes, ask model',
          cancelLabel: 'No',
        });
        if (!useAi) {
          optimizeError = error;
          return;
        }
        const modelIds = (get(models) || []).map((m) => m?.id).filter(Boolean);
        const { settings: aiSettings, prompt: aiPrompt, error: aiError } = await askModelForOptimalSettings(currentModelId, modelIds);
        if (aiError || Object.keys(aiSettings).length === 0) {
          optimizeError = aiError || 'Could not get settings from model.';
          return;
        }
        const payload = { ...aiSettings };
        setPerModelOverride(currentModelId, payload);
        updateGlobalDefault(payload);
        contextLength = payload.context_length ?? contextLength;
        temperature = payload.temperature ?? temperature;
        topP = payload.top_p ?? topP;
        topK = payload.top_k ?? topK;
        evalBatchSize = payload.eval_batch_size ?? evalBatchSize;
        cpuThreads = payload.cpu_threads ?? cpuThreads;
        nParallel = payload.n_parallel ?? nParallel;
        const replacePrompt = await confirm({
          title: 'Also optimize system prompt?',
          message: aiPrompt ? 'Your model suggested a system prompt. Replace your current one?' : 'Ask your model for a suggested system prompt?',
          confirmLabel: 'Yes',
          cancelLabel: 'Keep existing',
        });
        if (replacePrompt) {
          let promptToUse = aiPrompt;
          if (!promptToUse) {
            const res = await askModelForOptimalSettings(currentModelId, modelIds);
            promptToUse = res.prompt;
          }
          if (promptToUse) {
            setPerModelOverride(currentModelId, { system_prompt: promptToUse });
            updateGlobalDefault({ system_prompt: promptToUse });
            sysPrompt = promptToUse;
          }
        }
        optimizeError = null;
        return;
      }

      const payload = {};
      if (typeof optimal.context_length === 'number') payload.context_length = optimal.context_length;
      if (typeof optimal.eval_batch_size === 'number') payload.eval_batch_size = optimal.eval_batch_size;
      if (typeof optimal.temperature === 'number') payload.temperature = optimal.temperature;
      if (typeof optimal.top_p === 'number') payload.top_p = optimal.top_p;
      if (typeof optimal.top_k === 'number') payload.top_k = optimal.top_k;
      if (typeof optimal.repeat_penalty === 'number') payload.repeat_penalty = optimal.repeat_penalty;
      if (typeof optimal.cpu_threads === 'number') payload.cpu_threads = optimal.cpu_threads;
      if (typeof optimal.n_parallel === 'number') payload.n_parallel = optimal.n_parallel;
      if (typeof optimal.flash_attention === 'boolean') payload.flash_attention = optimal.flash_attention;
      if (typeof optimal.offload_kv_cache_to_gpu === 'boolean') payload.offload_kv_cache_to_gpu = optimal.offload_kv_cache_to_gpu;
      if (optimal.gpu_offload != null) payload.gpu_offload = optimal.gpu_offload;

      if (Object.keys(payload).length === 0) {
        const useAi = await confirm({
          title: 'Ask AI for settings?',
          message: 'No optimal settings found on Hugging Face. Ask your smartest loaded model for recommended settings?',
          confirmLabel: 'Yes, ask model',
          cancelLabel: 'No',
        });
        if (!useAi) {
          optimizeError = 'No optimal settings found. Use "Look up" to open the model card and find them manually.';
          return;
        }

        const modelIds = (get(models) || []).map((m) => m?.id).filter(Boolean);
        const { settings: aiSettings, error: aiError } = await askModelForOptimalSettings(currentModelId, modelIds);
        if (aiError || Object.keys(aiSettings).length === 0) {
          optimizeError = aiError || 'Could not get settings from model.';
          return;
        }

        Object.assign(payload, aiSettings);
      }

      setPerModelOverride(currentModelId, payload);
      updateGlobalDefault(payload);

      contextLength = payload.context_length ?? contextLength;
      temperature = payload.temperature ?? temperature;
      topP = payload.top_p ?? topP;
      topK = payload.top_k ?? topK;
      evalBatchSize = payload.eval_batch_size ?? evalBatchSize;
      cpuThreads = payload.cpu_threads ?? cpuThreads;
      nParallel = payload.n_parallel ?? nParallel;
      flashAttention = payload.flash_attention ?? flashAttention;
      offloadKvToGpu = payload.offload_kv_cache_to_gpu ?? offloadKvToGpu;
      if (payload.gpu_offload != null) gpuOffload = payload.gpu_offload;

      const suggestedPrompt = optimalPrompt?.trim();
      const replacePrompt = await confirm({
        title: 'Also optimize system prompt?',
        message: suggestedPrompt ? 'A suggested system prompt was found. Replace your current one?' : 'Ask your model for a suggested system prompt?',
        confirmLabel: 'Yes',
        cancelLabel: 'Keep existing',
      });
      if (replacePrompt) {
        let promptToUse = suggestedPrompt;
        if (!promptToUse) {
          const { prompt: aiPrompt } = await askModelForOptimalSettings(currentModelId, (get(models) || []).map((m) => m?.id).filter(Boolean));
          promptToUse = aiPrompt;
        }
        if (promptToUse) {
          setPerModelOverride(currentModelId, { system_prompt: promptToUse });
          updateGlobalDefault({ system_prompt: promptToUse });
          sysPrompt = promptToUse;
        }
      }

      optimizeError = null;
    } catch (e) {
      optimizeError = e?.message || 'Failed to fetch from Hugging Face.';
    } finally {
      optimizeApplying = false;
    }
  }

</script>

<div
  class="intel-panel flex flex-col h-full text-sm"
  style="color: var(--ui-text-secondary); background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);">
  <div class="flex-1 overflow-y-auto p-3 pb-4 min-h-0 flex flex-col gap-4">
  <!-- 1. System prompt -->
  <div>
    <div class="font-medium mb-1.5 text-xs flex items-center gap-1" style="color: var(--ui-text-primary);">
      System prompt
      <InfoTooltip text="Instructions that define the model's behavior. Sent at the start of each conversation.">
        <span class="w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[9px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span>
      </InfoTooltip>
    </div>
    <textarea
      id="intel-sys-prompt"
      class="w-full px-1.5 py-1 rounded border text-xs resize-y min-h-[72px]"
      style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
      placeholder="You are a helpful assistant."
      bind:value={sysPrompt}
      rows="3"></textarea>
  </div>

  <!-- 2. Current model -->
  <div>
    <div class="font-medium mb-1.5 text-xs flex items-center gap-1" style="color: var(--ui-text-primary);">
      Model
      <InfoTooltip text="The LLM selected in the header. Click Settings to change LM Studio URL or other app settings.">
        <span class="w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[9px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span>
      </InfoTooltip>
    </div>
    <div class="rounded-lg border p-2.5 flex flex-col gap-2 min-w-0 overflow-hidden" style="border-color: var(--ui-border); background: var(--ui-input-bg);">
      <div class="flex items-start gap-2 min-w-0 min-h-9">
        {#if currentModelId}
          <img src={getModelIcon(currentModelId, $modelIconOverrides)} alt="" class="w-6 h-6 shrink-0 rounded object-contain mt-0.5" />
          <div class="min-w-0 flex-1">
            <div class="text-xs font-medium break-words leading-snug" style="color: var(--ui-text-primary);">{currentModelId}</div>
            {#if getQuantization(currentModelId)}
              <span class="inline-block mt-1 text-xs px-1.5 py-0.5 rounded font-mono opacity-80" style="background: var(--ui-border);">{getQuantization(currentModelId)}</span>
            {/if}
          </div>
        {:else}
          <span class="text-xs opacity-70">Select in header</span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="intel-model-btn flex-1 min-w-0 text-xs font-medium py-1.5 rounded border transition-opacity hover:opacity-90 disabled:opacity-50"
          style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
          onclick={openSettings}
          title="Open settings">Settings</button>
        <button
          type="button"
          class="intel-model-btn flex-1 min-w-0 text-xs font-medium py-1.5 rounded border transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1"
          style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
          onclick={openHfLookup}
          disabled={hfLookupResolving || !currentModelId}
          title="Open Hugging Face model card in browser to look up optimal settings">
          {#if hfLookupResolving}<ThinkingAtom size={12} />{/if}
          {hfLookupResolving ? 'Looking up…' : 'Look up'}
        </button>
      </div>
    </div>
  </div>

  <!-- 3. Inference parameters -->
  <div>
    <div class="font-medium mb-1.5 text-xs flex items-center gap-1" style="color: var(--ui-text-primary);">
      Parameters
      <InfoTooltip text="Sampling parameters for generation. Higher temperature = more random; lower = more deterministic.">
        <span class="w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[9px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span>
      </InfoTooltip>
    </div>
    <div class="space-y-3">
      <div>
        <div class="flex justify-between text-xs mb-0.5"><span>Temperature<InfoTooltip text="Randomness of output. 0 = deterministic, 2 = very creative."><span class="ml-0.5 w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip></span><span class="font-mono">{temperature}</span></div>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={temperature}
          oninput={onTempInput}
          class="w-full h-1.5 rounded-full"
          style="background: var(--ui-input-bg); accent-color: var(--ui-accent);" />
      </div>
      <div>
        <div class="flex justify-between text-xs mb-0.5"><span>Top-P<InfoTooltip text="Nucleus sampling: only consider tokens whose cumulative probability is below this. 1 = no cutoff."><span class="ml-0.5 w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip></span><span class="font-mono">{topP}</span></div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={topP}
          oninput={onTopPInput}
          class="w-full h-1.5 rounded-full"
          style="background: var(--ui-input-bg); accent-color: var(--ui-accent);" />
      </div>
      <div>
        <div class="flex justify-between text-xs mb-0.5"><span>Top-K<InfoTooltip text="Limit sampling to the top K most likely tokens. Higher = more variety."><span class="ml-0.5 w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip></span><span class="font-mono">{topK}</span></div>
        <input
          type="range"
          min="1"
          max="200"
          step="1"
          value={topK}
          oninput={onTopKInput}
          class="w-full h-1.5 rounded-full"
          style="background: var(--ui-input-bg); accent-color: var(--ui-accent);" />
      </div>
      <div>
        <div class="flex justify-between text-xs mb-0.5"><span>Context<InfoTooltip text="Max context length in tokens. Higher = more history but more VRAM."><span class="ml-0.5 w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip></span><span class="font-mono">{contextLength}</span></div>
        <input
          type="range"
          min="512"
          max="131072"
          step="1024"
          value={contextLength}
          oninput={onContextInput}
          class="w-full h-1.5 rounded-full"
          style="background: var(--ui-input-bg); accent-color: var(--ui-accent);" />
      </div>
    </div>
  </div>

  <!-- 4. Context usage -->
  <div>
    <div class="font-medium mb-1.5 text-xs flex items-center gap-1" style="color: var(--ui-text-primary);">
      Context usage
      <InfoTooltip text="Estimated tokens used in this chat vs. max context length. Start a new chat to reset.">
        <span class="w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[9px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span>
      </InfoTooltip>
    </div>
    <div class="h-2 rounded-full overflow-hidden border" style="background: var(--ui-input-bg); border-color: var(--ui-border);">
      <div
        class="h-full rounded-full transition-all duration-300"
        style="width: {contextPercent}%; background: var(--ui-accent);"
        role="progressbar"
        aria-valuenow={contextPercent}
        aria-valuemin="0"
        aria-valuemax="100"></div>
    </div>
    <div class="mt-1 font-mono text-xs opacity-80">{estimatedContextUsed} / {contextLength} (est.)</div>
  </div>

  <!-- 5. Load settings -->
  <div>
    <div class="font-medium mb-1.5 text-xs flex items-center gap-1" style="color: var(--ui-text-primary);">
      Load
      <InfoTooltip text="Settings applied when the model loads. Save button loads the model with these.">
        <span class="w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[9px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span>
      </InfoTooltip>
    </div>
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <label for="intel-batch" class="text-xs shrink-0 w-20 flex items-center gap-0.5">Batch<InfoTooltip text="Eval batch size. Larger = faster inference but more VRAM."><span class="w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip></label>
        <div class="flex flex-1 gap-0.5">
          <button type="button" class="px-1.5 py-0.5 rounded-l border text-xs hover:opacity-90" style="border-color: var(--ui-border);" onclick={stepBatchDown} title="Half">▼</button>
          <input id="intel-batch" type="number" min={BATCH_SIZE_MIN} max={BATCH_SIZE_MAX} bind:value={evalBatchSize} class="flex-1 px-1.5 py-1 border text-xs min-w-0" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);" />
          <button type="button" class="px-1.5 py-0.5 rounded-r border text-xs hover:opacity-90" style="border-color: var(--ui-border);" onclick={stepBatchUp} title="Double">▲</button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <label for="intel-gpu-offload" class="text-xs shrink-0 w-20 flex items-center gap-0.5">GPU<InfoTooltip text="How much of the model to run on GPU. Max = all layers; Off = CPU only."><span class="w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip></label>
        <select id="intel-gpu-offload" bind:value={gpuOffload} class="flex-1 px-1.5 py-1 rounded border text-xs min-w-0" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);">
          {#each GPU_OFFLOAD_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>
      <div class="flex items-center gap-2">
        <label for="intel-ttl" class="text-xs shrink-0 w-20 flex items-center gap-0.5">TTL (s)<InfoTooltip text="Idle timeout in seconds. 0 = disabled. With LM Studio JIT, unloads model when idle to free VRAM."><span class="w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip></label>
        <input id="intel-ttl" type="number" min="0" step="60" bind:value={modelTtlSeconds} class="flex-1 px-1.5 py-1 rounded border text-xs min-w-0" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);" />
      </div>
      <div class="flex items-center gap-2">
        <label for="intel-cpu-threads" class="text-xs shrink-0 w-20 flex items-center gap-0.5">CPU thr<InfoTooltip text="CPU threads for inference when layers run on CPU. Use up to logical cores for best throughput."><span class="w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip></label>
        <input id="intel-cpu-threads" type="number" min="1" max={maxCpuThreads} bind:value={cpuThreads} class="flex-1 px-1.5 py-1 rounded border text-xs min-w-0" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);" />
      </div>
      <div class="flex items-center gap-2">
        <label for="intel-n-parallel" class="text-xs shrink-0 w-20 flex items-center gap-0.5">Parallel<InfoTooltip text="Max concurrent predictions (n_parallel). Higher = better Arena throughput; no extra VRAM with unified KV."><span class="w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip></label>
        <input id="intel-n-parallel" type="number" min="1" max="32" bind:value={nParallel} class="flex-1 px-1.5 py-1 rounded border text-xs min-w-0" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);" />
      </div>
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-1.5 cursor-pointer text-xs">
          <input type="checkbox" bind:checked={flashAttention} class="rounded accent-themed" />
          Flash attn<InfoTooltip text="Flash Attention: faster and more memory-efficient attention. Usually enable for best speed."><span class="w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip>
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer text-xs">
          <input type="checkbox" bind:checked={offloadKvToGpu} class="rounded accent-themed" />
          KV→GPU<InfoTooltip text="Offload KV cache to GPU. Frees CPU RAM; uses more VRAM."><span class="w-3 h-3 rounded-full border inline-flex items-center justify-center text-[8px] cursor-help opacity-60 hover:opacity-100" style="border-color: var(--ui-border);">i</span></InfoTooltip>
        </label>
      </div>
    </div>
    {#if loadError}
      <p class="text-xs text-red-500 dark:text-red-400 mt-1">{loadError}</p>
    {/if}
  </div>
  </div>

  <!-- Sticky footer: Optimize + Save -->
  <div class="shrink-0 p-3 pt-2 border-t space-y-2" style="border-color: var(--ui-border); background-color: var(--ui-bg-sidebar);">
    <button
      type="button"
      class="w-full py-2 px-4 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all duration-200 border"
      style="border-color: var(--ui-accent); color: var(--ui-accent); background: transparent;"
      onclick={optimize}
      disabled={optimizeApplying || loadApplying || !currentModelId}
      title="Fetch optimal settings from Hugging Face for this model">
      {#if optimizeApplying}
        <ThinkingAtom size={16} />
        <span>Searching Hugging Face…</span>
      {:else}
        <span aria-hidden="true">◇</span>
        <span>Optimize</span>
      {/if}
    </button>
    {#if optimizeError}
      <p class="text-xs text-amber-600 dark:text-amber-400">{optimizeError}</p>
    {/if}
    {#if modelCardReadme}
      <div class="border rounded-lg overflow-hidden" style="border-color: var(--ui-border);">
        <button
          type="button"
          class="w-full px-3 py-2 text-xs text-left flex items-center justify-between hover:opacity-90"
          style="color: var(--ui-text-primary); background: var(--ui-input-bg);"
          onclick={() => (modelCardExpanded = !modelCardExpanded)}>
          <span>{modelCardExpanded ? 'Hide' : 'View'} model card (scroll to find settings)</span>
          <span>{modelCardExpanded ? '▲' : '▼'}</span>
        </button>
        {#if modelCardExpanded}
          <div class="max-h-48 overflow-y-auto p-2 text-xs font-mono whitespace-pre-wrap" style="background: var(--ui-bg-sidebar); color: var(--ui-text-secondary);">{modelCardReadme}</div>
        {/if}
      </div>
    {/if}
    <button
      type="button"
      class="w-full py-2 px-4 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
      style="background-color: var(--ui-accent); color: white;"
      onclick={save}
      disabled={loadApplying || !currentModelId}
      title="Save all settings for this model and load it with LM Studio">
      {#if loadApplying}<ThinkingAtom size={14} />{/if}
      {loadApplying ? 'Saving…' : 'Save'}
    </button>
  </div>
</div>
