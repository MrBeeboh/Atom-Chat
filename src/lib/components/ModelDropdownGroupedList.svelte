<script>
  import { tick } from 'svelte';
  import { getModelIcon, ensureModelIcons, modelIconOverrides } from '$lib/modelIcons.js';
  import { getModelTypeTag, modelSelectorPrimaryLine, modelSelectorSecondaryLine } from '$lib/api.js';
  import ModelCapabilityBadges from '$lib/components/ModelCapabilityBadges.svelte';
  import { groupModelsForSelector } from '$lib/modelGroups.js';

  let {
    models = [],
    selectedId = '',
    onSelect = /** @param {string} _id */ (_id) => {},
    listboxId = 'model-listbox',
    panelOpen = false,
    enableSearch = true,
    showTypeTags = true,
  } = $props();

  let searchEl = $state(null);
  let searchQuery = $state('');

  const filteredFlat = $derived.by(() => {
    if (!enableSearch || !searchQuery.trim()) return models;
    const q = searchQuery.toLowerCase();
    return models.filter(
      (m) =>
        modelSelectorPrimaryLine(m.id).toLowerCase().includes(q) ||
        (typeof m.id === 'string' && m.id.toLowerCase().includes(q)),
    );
  });

  const grouped = $derived(groupModelsForSelector(filteredFlat));

  $effect(() => {
    if (models.length) ensureModelIcons(models.map((x) => x.id));
  });

  $effect(() => {
    if (!panelOpen || !enableSearch) return;
    searchQuery = '';
    tick().then(() => searchEl?.focus());
  });

  function onSearchKeydown(e) {
    if (e.key === 'Escape') return;
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(listboxId) : listboxId.replace(/\\/g, '\\\\');
      document.querySelector(`#${safe} .model-row`)?.focus();
    }
  }

  function headerDomId(bucket) {
    return `${listboxId}-hdr-${bucket.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }
</script>

{#if enableSearch}
  <div class="px-3 py-2 border-b" style="border-color: var(--ui-border);">
    <input
      bind:this={searchEl}
      type="text"
      placeholder="Search models…"
      bind:value={searchQuery}
      onkeydown={onSearchKeydown}
      class="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
      style="background: color-mix(in srgb, var(--ui-border) 30%, transparent); color: var(--ui-text-primary);"
      aria-label="Search models"
    />
  </div>
{/if}

{#if grouped.length === 0}
  <div class="px-4 py-3 text-sm" style="color: var(--ui-text-secondary);">
    {#if enableSearch && searchQuery.trim()}
      No models match "{searchQuery}"
    {:else}
      No models in this list
    {/if}
  </div>
{:else}
  {#each grouped as g (g.bucket)}
    <div class="model-provider-group" role="group" aria-labelledby={headerDomId(g.bucket)}>
      <div
        id={headerDomId(g.bucket)}
        class="model-provider-header px-3 py-2 top-0 z-[2]"
        style="background-color: color-mix(in srgb, var(--ui-bg-sidebar) 88%, var(--ui-border)); border-bottom: 1px solid var(--ui-border);"
      >
        <div
          class="text-[11px] font-semibold uppercase tracking-wider"
          style="color: var(--ui-text-primary); letter-spacing: 0.05em;"
        >
          {g.title}
        </div>
        <div class="text-[10px] mt-0.5 leading-snug" style="color: var(--ui-text-secondary);">
          {g.hint}
        </div>
      </div>
      {#each g.items as m (m.id)}
        {@const icon = getModelIcon(m.id, $modelIconOverrides)}
        {@const sub = modelSelectorSecondaryLine(m.id)}
        <button
          type="button"
          class="model-row flex items-start gap-2.5 w-full pl-4 pr-3 py-2 text-left text-sm transition-colors border-b border-transparent {m.id === selectedId ? 'model-row-selected' : ''}"
          style="border-bottom-color: color-mix(in srgb, var(--ui-border) 40%, transparent);"
          role="option"
          aria-selected={m.id === selectedId}
          onclick={() => onSelect(m.id)}
        >
          <img
            src={icon}
            alt=""
            class="w-5 h-5 shrink-0 rounded object-contain mt-0.5"
            onerror={(e) => (e.currentTarget.style.display = 'none')}
          />
          <span class="min-w-0 flex-1 flex flex-col gap-0.5">
            <span class="flex items-start gap-2 min-w-0">
              <span class="truncate font-medium" style="color: var(--ui-text-primary);"
                >{modelSelectorPrimaryLine(m.id)}</span
              >
              <span class="model-row-actions shrink-0 ml-auto flex items-center gap-1.5">
                {#if showTypeTags && getModelTypeTag(m.id)}
                  <span
                    class="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style="background: color-mix(in srgb, var(--ui-accent) 12%, transparent); color: var(--ui-accent);"
                    >{getModelTypeTag(m.id)}</span
                  >
                {/if}
                <ModelCapabilityBadges modelId={m.id} />
              </span>
            </span>
            {#if sub}
              <span
                class="truncate text-[10px] leading-tight font-mono"
                style="color: var(--ui-text-secondary); opacity: 0.9;"
                title={sub}>{sub}</span
              >
            {/if}
          </span>
        </button>
      {/each}
    </div>
  {/each}
{/if}

<style>
  .model-provider-header {
    position: sticky;
    top: 0;
  }
  .model-row-actions {
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .model-row:hover .model-row-actions {
    opacity: 1;
  }
  .model-row:hover {
    background-color: color-mix(in srgb, var(--ui-border) 32%, transparent);
  }
  .model-row.model-row-selected {
    background-color: color-mix(in srgb, var(--ui-accent) 10%, transparent);
    box-shadow: inset 3px 0 0 var(--ui-accent);
  }
  .model-row.model-row-selected .model-row-actions {
    opacity: 1;
  }
</style>
