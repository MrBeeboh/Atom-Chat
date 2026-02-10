<script>
  import { tick } from 'svelte';
  import { models, selectedModelId, updateSettings, hardware, presetDefaultModels, lmStudioBaseUrl } from '$lib/stores.js';
  import { getModels } from '$lib/api.js';
  import { getModelIcon, getQuantization, ensureModelIcons, modelIconOverrides } from '$lib/modelIcons.js';
  import { getDefaultsForModel } from '$lib/modelDefaults.js';
  import { getRecommendedFromHf } from '$lib/huggingface.js';

  let open = $state(false);
  let triggerEl = $state(null);
  let dropdownPlace = $state({ top: 0, left: 0, width: 200, maxHeight: 256, openUp: false });

  $effect(() => {
    if (!open || !triggerEl) return;
    const update = () => {
      if (!triggerEl || typeof window === 'undefined') return;
      const r = triggerEl.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
      const maxHeight = openUp ? Math.min(256, spaceAbove) : Math.min(256, spaceBelow);
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

  async function load() {
    try {
      const list = await getModels();
      const ids = list.map((m) => m.id);
      models.set(ids.map((id) => ({ id })));
      ensureModelIcons(ids);
      if (list.length && !$selectedModelId) {
        const presetOrder = ['General', 'Code', 'Research', 'Creative'];
        const defaultId = presetOrder.map((name) => $presetDefaultModels[name]).find((id) => id && ids.includes(id));
        const initial = defaultId ?? list[0].id;
        selectedModelId.set(initial);
        await applyDefaultsForModel(initial);
      }
    } catch (e) {
      console.warn('LM Studio models:', e);
      models.set([]);
    }
  }

  $effect(() => {
    $lmStudioBaseUrl;
    load();
  });

  async function select(id) {
    selectedModelId.set(id);
    await applyDefaultsForModel(id);
    open = false;
  }

  function toggle() {
    open = !open;
  }
</script>

<div class="flex items-center gap-2">
  <div class="relative" role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-controls="model-listbox" aria-label="Select model" bind:this={triggerEl}>
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg border text-sm px-3 py-2 max-w-[260px] focus:ring-2 font-semibold min-h-[36px] transition-colors duration-150 ui-model-selector {open ? 'ui-model-selector-open' : ''}"
      style="background-color: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
      onclick={toggle}
      onkeydown={(e) => e.key === 'Escape' && (open = false)}
      aria-label="Select model">
      {#if $selectedModelId}
        {@const selIcon = getModelIcon($selectedModelId, $modelIconOverrides)}
        <img src={selIcon} alt="" class="w-4 h-4 shrink-0 rounded object-contain" />
        <span class="truncate font-bold uppercase tracking-tight text-xs">{$selectedModelId}</span>
      {:else}
        <span class="text-zinc-500 dark:text-zinc-400">Select model</span>
      {/if}
      <svg class="w-4 h-4 shrink-0 ml-1 transition-transform duration-150 {open ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
    </button>
  {#if open}
    <div
      id="model-listbox"
      class="fixed z-[100] rounded-xl border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 shadow-lg py-1 overflow-y-auto"
      style="left: {dropdownPlace.left}px; width: {dropdownPlace.width}px; max-height: {dropdownPlace.maxHeight}px; {dropdownPlace.openUp ? 'bottom: ' + dropdownPlace.bottom + 'px; top: auto;' : 'top: ' + dropdownPlace.top + 'px;'}"
      role="listbox">
      {#each $models as m}
        {@const icon = getModelIcon(m.id, $modelIconOverrides)}
        <button
          type="button"
          class="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors {m.id === $selectedModelId ? 'bg-zinc-50 dark:bg-zinc-700/50 font-medium' : ''}"
          role="option"
          aria-selected={m.id === $selectedModelId}
          onclick={() => select(m.id)}>
          <img src={icon} alt="" class="w-5 h-5 shrink-0 rounded object-contain" />
          <span class="truncate">{m.id}</span>
        </button>
      {/each}
    </div>
    <button
      type="button"
      class="fixed inset-0 z-40"
      aria-label="Close"
      onclick={() => (open = false)}></button>
  {/if}
  </div>
  {#if $selectedModelId && getQuantization($selectedModelId)}
    <span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-400 shrink-0" title="Quantization">{getQuantization($selectedModelId)}</span>
  {/if}
</div>
