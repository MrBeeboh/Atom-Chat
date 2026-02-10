<script>
  import { tick } from 'svelte';
  import { models, dashboardModelA, dashboardModelB, dashboardModelC, dashboardModelD, updateSettings, hardware, lmStudioBaseUrl } from '$lib/stores.js';
  import { getModels } from '$lib/api.js';
  import { getModelIcon, getQuantization, ensureModelIcons, modelIconOverrides } from '$lib/modelIcons.js';
  import { getDefaultsForModel } from '$lib/modelDefaults.js';
  import { getRecommendedFromHf } from '$lib/huggingface.js';

  let { slot = 'A' } = $props();
  let open = $state(false);
  let loading = $state(false);
  let loadError = $state(null);
  let triggerEl = $state(null);
  let dropdownPlace = $state({ top: 0, left: 0, width: 200, maxHeight: 420, openUp: false, bottom: 0 });

  $effect(() => {
    if (!open || !triggerEl) return;
    const update = () => {
      if (!triggerEl || typeof window === 'undefined') return;
      const r = triggerEl.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
      const maxHeight = openUp ? Math.min(420, spaceAbove) : Math.min(420, spaceBelow);
      dropdownPlace = {
        top: r.bottom + 4,
        bottom: window.innerHeight - r.top + 4,
        left: r.left,
        width: Math.max(r.width, 200),
        maxHeight: Math.max(120, maxHeight),
        openUp,
      };
    };
    tick().then(update);
    const id = requestAnimationFrame(update);
    return () => cancelAnimationFrame(id);
  });

  async function loadModels() {
    if (loading) return;
    loading = true;
    loadError = null;
    try {
      const list = await getModels();
      const ids = list.map((m) => m.id);
      models.set(ids.map((id) => ({ id })));
      ensureModelIcons(ids);
    } catch (e) {
      loadError = e?.message || 'Could not load models';
      models.set([]);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    $lmStudioBaseUrl;
    loadModels();
  });

  function toggle() {
    const willOpen = !open;
    open = willOpen;
    if (willOpen) loadModels();
  }

  function getStore() {
    return slot === 'B' ? dashboardModelB : slot === 'C' ? dashboardModelC : slot === 'D' ? dashboardModelD : dashboardModelA;
  }

  async function applyDefaultsForModel(modelId) {
    const hw = $hardware;
    let hfOverrides = {};
    try {
      hfOverrides = await getRecommendedFromHf(modelId);
    } catch (_) {}
    const d = getDefaultsForModel(modelId, hw, hfOverrides);
    updateSettings({
      context_length: d.context_length,
      eval_batch_size: d.eval_batch_size,
      flash_attention: d.flash_attention,
      offload_kv_cache_to_gpu: d.offload_kv_cache_to_gpu,
      gpu_offload: d.gpu_offload ?? 'max',
      cpu_threads: d.cpu_threads,
      temperature: d.temperature,
      max_tokens: d.max_tokens,
      top_p: d.top_p,
      top_k: d.top_k,
      repeat_penalty: d.repeat_penalty,
    });
  }

  async function select(id) {
    getStore().set(id);
    if (slot === 'A') await applyDefaultsForModel(id);
    open = false;
  }

</script>

{#if slot === 'A'}
  {@const val = $dashboardModelA}
  <div class="flex items-center gap-2">
    <div class="relative flex-1 min-w-0" role="combobox" aria-expanded={open} aria-controls="model-listbox-A" aria-haspopup="listbox" aria-label="Select model A" bind:this={triggerEl}>
      <button type="button" class="flex items-center gap-2 rounded-lg border text-sm px-3 py-2 w-full min-h-[36px] transition-colors duration-150 ui-model-selector {open ? 'ui-model-selector-open' : ''}" style="background-color: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);" onclick={toggle} onkeydown={(e) => e.key === 'Escape' && (open = false)} aria-label="Select model A">
        {#if val}
          {@const selIcon = getModelIcon(val, $modelIconOverrides)}
          {#if selIcon}<img src={selIcon} alt="" class="w-4 h-4 shrink-0 rounded object-contain" />{/if}
          <span class="truncate font-bold uppercase tracking-tight text-xs">{val}</span>
        {:else}<span class="text-zinc-500 dark:text-zinc-400">Select model</span>{/if}
        <svg class="w-4 h-4 shrink-0 ml-1 transition-transform duration-150 {open ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {#if open}
        <div id="model-listbox-A" class="fixed z-[100] rounded-xl border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 shadow-lg py-1 overflow-y-auto min-w-[200px]" style="left: {dropdownPlace.left}px; width: {dropdownPlace.width}px; max-height: {dropdownPlace.maxHeight}px; {dropdownPlace.openUp ? 'bottom: ' + dropdownPlace.bottom + 'px; top: auto;' : 'top: ' + dropdownPlace.top + 'px;'}" role="listbox">
          {#if loading}
            <div class="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">Loading models…</div>
          {:else if $models.length === 0}
            <div class="px-4 py-3 text-sm">
              <p class="text-zinc-600 dark:text-zinc-400 mb-2">No models found. Is LM Studio running on port 1234? Have you downloaded any models?</p>
              {#if loadError}<p class="text-red-600 dark:text-red-400 text-xs mb-2">{loadError}</p>{/if}
              <button type="button" class="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700" onclick={(e) => { e.stopPropagation(); loadModels(); }}>Retry</button>
            </div>
          {:else}
            {#each $models as m}
              {@const icon = getModelIcon(m.id, $modelIconOverrides)}
              <button type="button" class="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors {val === m.id ? 'bg-zinc-50 dark:bg-zinc-700/50 font-medium' : ''}" role="option" aria-selected={val === m.id} onclick={() => select(m.id)}>
                <img src={icon} alt="" class="w-5 h-5 shrink-0 rounded object-contain" />
                <span class="truncate">{m.id}</span>
              </button>
            {/each}
          {/if}
        </div>
        <button type="button" class="fixed inset-0 z-40" aria-label="Close" onclick={() => (open = false)}></button>
      {/if}
    </div>
    {#if val && getQuantization(val)}<span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-400 shrink-0" title="Quantization">{getQuantization(val)}</span>{/if}
  </div>
{:else if slot === 'B'}
  {@const val = $dashboardModelB}
  <div class="flex items-center gap-2">
    <div class="relative flex-1 min-w-0" role="combobox" aria-expanded={open} aria-controls="model-listbox-B" aria-haspopup="listbox" aria-label="Select model B" bind:this={triggerEl}>
      <button type="button" class="flex items-center gap-2 rounded-lg border text-sm px-3 py-2 w-full min-h-[36px] transition-colors duration-150 ui-model-selector {open ? 'ui-model-selector-open' : ''}" style="background-color: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);" onclick={toggle} onkeydown={(e) => e.key === 'Escape' && (open = false)} aria-label="Select model B">
        {#if val}
          {@const selIcon = getModelIcon(val, $modelIconOverrides)}
          {#if selIcon}<img src={selIcon} alt="" class="w-4 h-4 shrink-0 rounded object-contain" />{/if}
          <span class="truncate font-bold uppercase tracking-tight text-xs">{val}</span>
        {:else}<span class="text-zinc-500 dark:text-zinc-400">Select model</span>{/if}
        <svg class="w-4 h-4 shrink-0 ml-1 transition-transform duration-150 {open ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {#if open}
        <div id="model-listbox-B" class="fixed z-[100] rounded-xl border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 shadow-lg py-1 overflow-y-auto min-w-[200px]" style="left: {dropdownPlace.left}px; width: {dropdownPlace.width}px; max-height: {dropdownPlace.maxHeight}px; {dropdownPlace.openUp ? 'bottom: ' + dropdownPlace.bottom + 'px; top: auto;' : 'top: ' + dropdownPlace.top + 'px;'}" role="listbox">
          {#if loading}
            <div class="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">Loading models…</div>
          {:else if $models.length === 0}
            <div class="px-4 py-3 text-sm">
              <p class="text-zinc-600 dark:text-zinc-400 mb-2">No models found. Is LM Studio running on port 1234? Have you downloaded any models?</p>
              {#if loadError}<p class="text-red-600 dark:text-red-400 text-xs mb-2">{loadError}</p>{/if}
              <button type="button" class="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700" onclick={(e) => { e.stopPropagation(); loadModels(); }}>Retry</button>
            </div>
          {:else}
            {#each $models as m}
              {@const icon = getModelIcon(m.id, $modelIconOverrides)}
              <button type="button" class="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors {val === m.id ? 'bg-zinc-50 dark:bg-zinc-700/50 font-medium' : ''}" role="option" aria-selected={val === m.id} onclick={() => select(m.id)}>
                <img src={icon} alt="" class="w-5 h-5 shrink-0 rounded object-contain" />
                <span class="truncate">{m.id}</span>
              </button>
            {/each}
          {/if}
        </div>
        <button type="button" class="fixed inset-0 z-40" aria-label="Close" onclick={() => (open = false)}></button>
      {/if}
    </div>
    {#if val && getQuantization(val)}<span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-400 shrink-0" title="Quantization">{getQuantization(val)}</span>{/if}
  </div>
{:else if slot === 'C'}
  {@const val = $dashboardModelC}
  <div class="flex items-center gap-2">
    <div class="relative flex-1 min-w-0" role="combobox" aria-expanded={open} aria-controls="model-listbox-C" aria-haspopup="listbox" aria-label="Select model C" bind:this={triggerEl}>
      <button type="button" class="flex items-center gap-2 rounded-lg border text-sm px-3 py-2 w-full min-h-[36px] transition-colors duration-150 ui-model-selector {open ? 'ui-model-selector-open' : ''}" style="background-color: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);" onclick={toggle} onkeydown={(e) => e.key === 'Escape' && (open = false)} aria-label="Select model C">
        {#if val}
          {@const selIcon = getModelIcon(val, $modelIconOverrides)}
          {#if selIcon}<img src={selIcon} alt="" class="w-4 h-4 shrink-0 rounded object-contain" />{/if}
          <span class="truncate font-bold uppercase tracking-tight text-xs">{val}</span>
        {:else}<span class="text-zinc-500 dark:text-zinc-400">Select model</span>{/if}
        <svg class="w-4 h-4 shrink-0 ml-1 transition-transform duration-150 {open ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {#if open}
        <div id="model-listbox-C" class="fixed z-[100] rounded-xl border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 shadow-lg py-1 overflow-y-auto min-w-[200px]" style="left: {dropdownPlace.left}px; width: {dropdownPlace.width}px; max-height: {dropdownPlace.maxHeight}px; {dropdownPlace.openUp ? 'bottom: ' + dropdownPlace.bottom + 'px; top: auto;' : 'top: ' + dropdownPlace.top + 'px;'}" role="listbox">
          {#if loading}
            <div class="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">Loading models…</div>
          {:else if $models.length === 0}
            <div class="px-4 py-3 text-sm">
              <p class="text-zinc-600 dark:text-zinc-400 mb-2">No models found. Is LM Studio running on port 1234? Have you downloaded any models?</p>
              {#if loadError}<p class="text-red-600 dark:text-red-400 text-xs mb-2">{loadError}</p>{/if}
              <button type="button" class="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700" onclick={(e) => { e.stopPropagation(); loadModels(); }}>Retry</button>
            </div>
          {:else}
            {#each $models as m}
              {@const icon = getModelIcon(m.id, $modelIconOverrides)}
              <button type="button" class="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors {val === m.id ? 'bg-zinc-50 dark:bg-zinc-700/50 font-medium' : ''}" role="option" aria-selected={val === m.id} onclick={() => select(m.id)}>
                <img src={icon} alt="" class="w-5 h-5 shrink-0 rounded object-contain" />
                <span class="truncate">{m.id}</span>
              </button>
            {/each}
          {/if}
        </div>
        <button type="button" class="fixed inset-0 z-40" aria-label="Close" onclick={() => (open = false)}></button>
      {/if}
    </div>
    {#if val && getQuantization(val)}<span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-400 shrink-0" title="Quantization">{getQuantization(val)}</span>{/if}
  </div>
{:else}
  {@const val = $dashboardModelD}
  <div class="flex items-center gap-2">
    <div class="relative flex-1 min-w-0" role="combobox" aria-expanded={open} aria-controls="model-listbox-D" aria-haspopup="listbox" aria-label="Select model D" bind:this={triggerEl}>
      <button type="button" class="flex items-center gap-2 rounded-lg border text-sm px-3 py-2 w-full min-h-[36px] transition-colors duration-150 ui-model-selector {open ? 'ui-model-selector-open' : ''}" style="background-color: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);" onclick={toggle} onkeydown={(e) => e.key === 'Escape' && (open = false)} aria-label="Select model D">
        {#if val}
          {@const selIcon = getModelIcon(val, $modelIconOverrides)}
          {#if selIcon}<img src={selIcon} alt="" class="w-4 h-4 shrink-0 rounded object-contain" />{/if}
          <span class="truncate font-bold uppercase tracking-tight text-xs">{val}</span>
        {:else}<span class="text-zinc-500 dark:text-zinc-400">Select model</span>{/if}
        <svg class="w-4 h-4 shrink-0 ml-1 transition-transform duration-150 {open ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {#if open}
        <div id="model-listbox-D" class="fixed z-[100] rounded-xl border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 shadow-lg py-1 overflow-y-auto min-w-[200px]" style="left: {dropdownPlace.left}px; width: {dropdownPlace.width}px; max-height: {dropdownPlace.maxHeight}px; {dropdownPlace.openUp ? 'bottom: ' + dropdownPlace.bottom + 'px; top: auto;' : 'top: ' + dropdownPlace.top + 'px;'}" role="listbox">
          {#if loading}
            <div class="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">Loading models…</div>
          {:else if $models.length === 0}
            <div class="px-4 py-3 text-sm">
              <p class="text-zinc-600 dark:text-zinc-400 mb-2">No models found. Is LM Studio running on port 1234? Have you downloaded any models?</p>
              {#if loadError}<p class="text-red-600 dark:text-red-400 text-xs mb-2">{loadError}</p>{/if}
              <button type="button" class="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700" onclick={(e) => { e.stopPropagation(); loadModels(); }}>Retry</button>
            </div>
          {:else}
            {#each $models as m}
              {@const icon = getModelIcon(m.id, $modelIconOverrides)}
              <button type="button" class="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors {val === m.id ? 'bg-zinc-50 dark:bg-zinc-700/50 font-medium' : ''}" role="option" aria-selected={val === m.id} onclick={() => select(m.id)}>
                <img src={icon} alt="" class="w-5 h-5 shrink-0 rounded object-contain" />
                <span class="truncate">{m.id}</span>
              </button>
            {/each}
          {/if}
        </div>
        <button type="button" class="fixed inset-0 z-40" aria-label="Close" onclick={() => (open = false)}></button>
      {/if}
    </div>
    {#if val && getQuantization(val)}<span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-400 shrink-0" title="Quantization">{getQuantization(val)}</span>{/if}
  </div>
{/if}
