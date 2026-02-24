<script>
  import { tick } from 'svelte';
  import { models, selectedModelId, presetDefaultModels, lmStudioBaseUrl, modelSelectionNotification } from '$lib/stores.js';
  import { getModels, modelDisplayName, getModelTypeTag } from '$lib/api.js';
  import { getModelIcon, getQuantization, ensureModelIcons, modelIconOverrides } from '$lib/modelIcons.js';
  import { findSmallestModel } from '$lib/utils/modelSelection.js';
  import ModelCapabilityBadges from '$lib/components/ModelCapabilityBadges.svelte';
  import ThinkingAtom from '$lib/components/ThinkingAtom.svelte';
  import { COCKPIT_LOADING_MODELS, pickWitty } from '$lib/cockpitCopy.js';

  let open = $state(false);
  let loading = $state(false);
  let triggerEl = $state(null);
  let dropdownPlace = $state({ top: 0, left: 0, bottom: 0, width: 200, maxHeight: 420, openUp: false });
  let loadingMessage = $state('');

  $effect(() => {
    if (loading) loadingMessage = pickWitty(COCKPIT_LOADING_MODELS);
  });

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
        width: Math.max(r.width, 280),
        maxHeight: Math.max(120, maxHeight),
        openUp,
      };
    };
    tick().then(update);
    const id = requestAnimationFrame(update);
    return () => cancelAnimationFrame(id);
  });

  async function applyDefaultsForModel(_modelId) {
    // Generation params (temperature, etc.) now come from global + recommended + per-model overrides.
    // Load config is applied in Settings when user clicks Load.
  }

  async function load() {
    loading = true;
    try {
      const list = await getModels();
      const ids = list.map((m) => m.id);
      models.set(ids.map((id) => ({ id })));
      ensureModelIcons(ids);

      if (list.length === 0) {
        modelSelectionNotification.set('No models available. Please load a model in LM Studio.');
        return;
      }
      modelSelectionNotification.set(null);

      const stored = typeof localStorage !== 'undefined' ? (localStorage.getItem('selectedModel') || '') : '';
      const storedValid = typeof stored === 'string' && stored.trim() && ids.includes(stored.trim());

      if (storedValid) {
        selectedModelId.set(stored.trim());
        await applyDefaultsForModel(stored.trim());
        return;
      }

      const smallest = findSmallestModel(ids);
      if (smallest) {
        selectedModelId.set(smallest);
        await applyDefaultsForModel(smallest);
        if (stored.trim()) {
          modelSelectionNotification.set(`Previous model unavailable, selected ${smallest}`);
          setTimeout(() => modelSelectionNotification.set(null), 5000);
        }
      }
    } catch (e) {
      console.warn('LM Studio models:', e);
      models.set([]);
      modelSelectionNotification.set('Cannot connect to LM Studio. Please ensure server is running.');
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    $lmStudioBaseUrl;
    load();
  });

  async function select(id) {
    selectedModelId.set(id);
    modelSelectionNotification.set(null);
    await applyDefaultsForModel(id);
    open = false;
  }

  function toggle() {
    const willOpen = !open;
    open = willOpen;
    if (willOpen) load();
  }
</script>

<div class="flex flex-col gap-1 min-w-0">
  <div class="flex items-center gap-2">
  <div class="relative" role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-controls="model-listbox" aria-label="Select model" bind:this={triggerEl}>
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg border text-sm px-3 py-2 max-w-[420px] focus:ring-2 focus:ring-offset-1 font-semibold min-h-[44px] transition-colors duration-150 ui-model-selector {open ? 'ui-model-selector-open' : ''}"
      style="background-color: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
      onclick={toggle}
      onkeydown={(e) => e.key === 'Escape' && (open = false)}
      aria-label="Select model"
      title={modelDisplayName($selectedModelId) || 'Select model'}>
      {#if $selectedModelId}
        {@const selIcon = getModelIcon($selectedModelId, $modelIconOverrides)}
        <img src={selIcon} alt="" class="w-4 h-4 shrink-0 rounded object-contain" />
        <span class="truncate font-bold uppercase tracking-tight text-xs">{modelDisplayName($selectedModelId)}</span>
        {#if getModelTypeTag($selectedModelId)}
          <span class="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, var(--ui-accent) 12%, transparent); color: var(--ui-accent);">{getModelTypeTag($selectedModelId)}</span>
        {/if}
        <ModelCapabilityBadges modelId={$selectedModelId} class="ml-0.5" />
      {:else}
        <span class="text-zinc-500 dark:text-zinc-400">Select model</span>
      {/if}
      <svg class="w-4 h-4 shrink-0 ml-1 transition-transform duration-150 {open ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
    </button>
  {#if open}
    <div
      id="model-listbox"
      class="fixed z-[100] rounded-xl border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 shadow-lg py-1 overflow-y-auto overflow-x-visible min-w-[280px]"
      style="left: {dropdownPlace.left}px; width: {dropdownPlace.width}px; max-height: {dropdownPlace.maxHeight}px; {dropdownPlace.openUp ? 'bottom: ' + dropdownPlace.bottom + 'px; top: auto;' : 'top: ' + dropdownPlace.top + 'px;'}"
      role="listbox">
      {#if loading}
        <div class="px-4 py-3 text-sm flex items-center gap-2" style="color: var(--ui-text-secondary);">
          <ThinkingAtom size={16} />
          {loadingMessage || 'Loading models…'}
        </div>
      {:else if $models.length === 0}
        <div class="px-4 py-3 text-sm" style="color: var(--ui-text-secondary);">No models found. Is LM Studio running?</div>
      {:else}
      {#each $models as m}
        {@const icon = getModelIcon(m.id, $modelIconOverrides)}
        <button
          type="button"
          class="model-row flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors {m.id === $selectedModelId ? 'bg-zinc-50 dark:bg-zinc-700/50 font-medium' : ''}"
          role="option"
          aria-selected={m.id === $selectedModelId}
          onclick={() => select(m.id)}>
          <img src={icon} alt="" class="w-5 h-5 shrink-0 rounded object-contain" />
          <span class="min-w-0 flex-1 flex items-center gap-1.5">
            <span class="truncate">{modelDisplayName(m.id)}</span>
            <span class="model-row-actions shrink-0 flex items-center gap-1.5">
              {#if getModelTypeTag(m.id)}
                <span class="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, var(--ui-accent) 12%, transparent); color: var(--ui-accent);">{getModelTypeTag(m.id)}</span>
              {/if}
              <ModelCapabilityBadges modelId={m.id} />
            </span>
          </span>
        </button>
      {/each}
      {/if}
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
  {#if $modelSelectionNotification}
    <p class="text-[10px] truncate max-w-full" style="color: var(--ui-text-secondary);" title={$modelSelectionNotification}>
      {$modelSelectionNotification}
    </p>
  {/if}
</div>

<style>
  .model-row-actions {
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .model-row:hover .model-row-actions {
    opacity: 1;
  }
</style>
