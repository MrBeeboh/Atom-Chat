<script>
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { models, selectedModelId, lmStudioBaseUrl, modelSelectionNotification, settingsOpen, settingsFocus } from '$lib/stores.js';
  import { modelDisplayName, getModelTypeTag } from '$lib/api.js';
  import { refreshConnectionAndModels } from '$lib/connectionSetup.js';
  import { getModelIcon, getQuantization, modelIconOverrides } from '$lib/modelIcons.js';
  import { formatPriceLine, modelPricing } from '$lib/modelPricing.js';
  import ModelCapabilityBadges from '$lib/components/ModelCapabilityBadges.svelte';
  import ModelDropdownGroupedList from '$lib/components/ModelDropdownGroupedList.svelte';
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
        width: Math.max(r.width, 340),
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
      const { modelCount } = await refreshConnectionAndModels();
      const sid = get(selectedModelId);
      if (modelCount > 0 && sid) {
        await applyDefaultsForModel(sid);
      }
    } catch (e) {
      console.warn('Model list refresh:', e);
      modelSelectionNotification.set('Cannot connect. Run ./scripts/start-atom.sh or check Settings → Connection.');
    } finally {
      loading = false;
    }
  }

  function openSetupSettings() {
    settingsFocus.set('connection');
    settingsOpen.set(true);
    open = false;
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
        <img src={selIcon} alt="" class="w-4 h-4 shrink-0 rounded object-contain" onerror={(e) => (e.currentTarget.style.display = 'none')} />
        <span class="truncate font-bold uppercase tracking-tight text-xs">{modelDisplayName($selectedModelId)}</span>
        {#if formatPriceLine($selectedModelId, $modelPricing)}
          <span class="shrink-0 text-[10px] font-medium tabular-nums normal-case tracking-normal" style="color: var(--ui-text-secondary);">{formatPriceLine($selectedModelId, $modelPricing)}</span>
        {/if}
        {#if getModelTypeTag($selectedModelId)}
          <span class="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, var(--ui-accent) 12%, transparent); color: var(--ui-accent);">{getModelTypeTag($selectedModelId)}</span>
        {/if}
        <ModelCapabilityBadges modelId={$selectedModelId} class="ml-0.5" />
      {:else}
        <span style="color: var(--ui-text-secondary);">Select model</span>
      {/if}
      <svg class="w-4 h-4 shrink-0 ml-1 transition-transform duration-150 {open ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
    </button>
  {#if open}
    <div
      id="model-listbox"
      class="fixed z-[100] rounded-xl shadow-lg py-0 overflow-y-auto overflow-x-visible min-w-[320px]"
      style="border: 1px solid var(--ui-border); background-color: var(--ui-bg-main); left: {dropdownPlace.left}px; width: {dropdownPlace.width}px; max-height: {dropdownPlace.maxHeight}px; {dropdownPlace.openUp ? 'bottom: ' + dropdownPlace.bottom + 'px; top: auto;' : 'top: ' + dropdownPlace.top + 'px;'}"
      role="listbox">
      {#if loading}
        <div class="px-4 py-3 text-sm flex items-center gap-2" style="color: var(--ui-text-secondary);">
          <ThinkingAtom size={16} />
          {loadingMessage || 'Loading models…'}
        </div>
      {:else if $models.length === 0}
        <div class="px-4 py-3 text-sm flex flex-col gap-2" style="color: var(--ui-text-secondary);">
          <p>
            No models found. Run <span class="font-mono">./scripts/start-atom.sh</span> (llama-server on :8080),
            use LM Studio on :1234, or add a cloud API key in Settings.
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="px-2.5 py-1 rounded-md text-xs font-medium"
              style="background: var(--ui-accent); color: var(--ui-bg-main);"
              onclick={() => { load(); }}
            >Retry</button>
            <button
              type="button"
              class="px-2.5 py-1 rounded-md text-xs font-medium"
              style="border: 1px solid var(--ui-border); color: var(--ui-text-primary);"
              onclick={openSetupSettings}
            >Settings</button>
          </div>
        </div>
      {:else}
        <ModelDropdownGroupedList
          models={$models}
          selectedId={$selectedModelId}
          onSelect={select}
          listboxId="model-listbox"
          panelOpen={open}
          enableSearch={true}
          showTypeTags={true}
        />
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
    <span class="font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0" style="background: color-mix(in srgb, var(--ui-border) 50%, transparent); color: var(--ui-text-secondary);" title="Quantization">{getQuantization($selectedModelId)}</span>
  {/if}
  </div>
  {#if $modelSelectionNotification}
    <p class="text-[10px] truncate max-w-full" style="color: var(--ui-text-secondary);" title={$modelSelectionNotification}>
      {$modelSelectionNotification}
    </p>
  {/if}
</div>

