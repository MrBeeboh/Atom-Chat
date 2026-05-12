<script>
  import { tick } from 'svelte';
  import { models, dashboardModelA, dashboardModelB, dashboardModelC, dashboardModelD } from '$lib/stores.js';
  import { getModels, modelDisplayName } from '$lib/api.js';
  import { getModelIcon, getQuantization, ensureModelIcons, modelIconOverrides } from '$lib/modelIcons.js';
  import ModelCapabilityBadges from '$lib/components/ModelCapabilityBadges.svelte';
  import ModelDropdownGroupedList from '$lib/components/ModelDropdownGroupedList.svelte';
  import ThinkingAtom from '$lib/components/ThinkingAtom.svelte';
  import { COCKPIT_LOADING_MODELS, pickWitty } from '$lib/cockpitCopy.js';

  let { slot = 'A' } = $props();
  let open = $state(false);
  let loading = $state(false);
  let loadError = $state(null);
  let triggerEl = $state(null);
  let dropdownPlace = $state({ top: 0, left: 0, width: 200, maxHeight: 420, openUp: false, bottom: 0 });
  let loadingMessage = $state('');

  const val = $derived(
    slot === 'B'
      ? $dashboardModelB
      : slot === 'C'
        ? $dashboardModelC
        : slot === 'D'
          ? $dashboardModelD
          : $dashboardModelA,
  );

  const listboxId = $derived(`model-listbox-${slot}`);

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
        width: Math.max(r.width, 340),
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
      const list = await Promise.race([
        getModels(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('Request timed out. Is llama-server (8080) or your backend running?')), 12000),
        ),
      ]);
      const ids = list.map((m) => m.id);
      if (ids.length > 0) {
        models.set(ids.map((id) => ({ id })));
        ensureModelIcons(ids);
      }
    } catch (e) {
      loadError = e?.message || 'Could not load models';
      if ($models.length === 0) models.set([]);
    } finally {
      loading = false;
    }
  }

  function toggle() {
    const willOpen = !open;
    open = willOpen;
    if (willOpen) loadModels();
  }

  function getStore() {
    return slot === 'B' ? dashboardModelB : slot === 'C' ? dashboardModelC : slot === 'D' ? dashboardModelD : dashboardModelA;
  }

  async function select(id) {
    getStore().set(id);
    open = false;
  }
</script>

<div class="flex items-center gap-2">
  <div
    class="relative flex-1 min-w-0"
    role="combobox"
    aria-expanded={open}
    aria-controls={listboxId}
    aria-haspopup="listbox"
    aria-label="Select model {slot}"
    bind:this={triggerEl}
  >
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg border text-sm px-3 py-2 w-full min-h-[36px] transition-colors duration-150 ui-model-selector {open ? 'ui-model-selector-open' : ''}"
      style="background-color: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
      onclick={toggle}
      onkeydown={(e) => e.key === 'Escape' && (open = false)}
      aria-label="Select model {slot}"
    >
      {#if val}
        {@const selIcon = getModelIcon(val, $modelIconOverrides)}
        {#if selIcon}<img src={selIcon} alt="" class="w-4 h-4 shrink-0 rounded object-contain" onerror={(e) => (e.currentTarget.style.display = 'none')} />{/if}
        <span class="truncate font-bold uppercase tracking-tight text-xs">{modelDisplayName(val)}</span>
        <ModelCapabilityBadges modelId={val} class="ml-0.5" />
      {:else}
        <span style="color: var(--ui-text-secondary);">Select model</span>
      {/if}
      <svg class="w-4 h-4 shrink-0 ml-1 transition-transform duration-150 {open ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
    </button>
    {#if open}
      <div
        id={listboxId}
        class="fixed z-[100] rounded-xl shadow-lg py-0 overflow-y-auto overflow-x-visible min-w-[320px]"
        style="border: 1px solid var(--ui-border); background-color: var(--ui-bg-main); left: {dropdownPlace.left}px; width: {dropdownPlace.width}px; max-height: {dropdownPlace.maxHeight}px; {dropdownPlace.openUp ? 'bottom: ' + dropdownPlace.bottom + 'px; top: auto;' : 'top: ' + dropdownPlace.top + 'px;'}"
        role="listbox"
      >
        {#if loading}
          <div class="px-4 py-3 text-sm flex items-center gap-2" style="color: var(--ui-text-secondary);">
            <ThinkingAtom size={16} />{loadingMessage || 'Loading models…'}
          </div>
        {:else if $models.length === 0}
          <div class="px-4 py-3 text-sm">
            <p class="mb-2" style="color: var(--ui-text-secondary);">
              No models found. Start your inference server (llama.cpp or LM Studio) or check Settings → Connection.
            </p>
            {#if loadError}<p class="text-red-600 dark:text-red-400 text-xs mb-2">{loadError}</p>{/if}
            <button
              type="button"
              class="text-sm px-3 py-1.5 rounded-lg"
              style="border: 1px solid var(--ui-border); color: var(--ui-text-primary); background: var(--ui-input-bg);"
              onclick={(e) => {
                e.stopPropagation();
                loadModels();
              }}>Retry</button>
          </div>
        {:else}
          <ModelDropdownGroupedList
            models={$models}
            selectedId={val || ''}
            onSelect={select}
            listboxId={listboxId}
            panelOpen={open}
            enableSearch={true}
            showTypeTags={false}
          />
        {/if}
      </div>
      <button type="button" class="fixed inset-0 z-40" aria-label="Close" onclick={() => (open = false)}></button>
    {/if}
  </div>
  {#if val && getQuantization(val)}
    <span
      class="font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0"
      style="background: color-mix(in srgb, var(--ui-border) 50%, transparent); color: var(--ui-text-secondary);"
      title="Quantization">{getQuantization(val)}</span>
  {/if}
</div>
