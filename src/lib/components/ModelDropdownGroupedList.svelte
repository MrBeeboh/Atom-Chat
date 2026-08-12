<script>
  import { tick } from 'svelte';
  import { getModelIcon, ensureModelIcons, modelIconOverrides } from '$lib/modelIcons.js';
  import { getModelTypeTag, modelSelectorPrimaryLine, modelSelectorSecondaryLine } from '$lib/api.js';
  import ModelCapabilityBadges from '$lib/components/ModelCapabilityBadges.svelte';
  import { groupModelsForSelector, bucketForModelId } from '$lib/modelGroups.js';

  let {
    models = [],
    selectedId = '',
    onSelect = () => {},
    listboxId = 'model-listbox',
    panelOpen = false,
    enableSearch = true,
    showTypeTags = true,
  } = $props();

  let searchEl = $state(null);
  let searchQuery = $state('');
  let activeBucket = $state('all');
  /** @type {Record<string, boolean>} */
  let collapsed = $state({});

  const allGrouped = $derived(groupModelsForSelector(models));

  const filteredFlat = $derived.by(() => {
    const q = enableSearch ? searchQuery.trim().toLowerCase() : '';
    return models.filter((m) => {
      if (!m?.id) return false;
      if (activeBucket !== 'all' && bucketForModelId(m.id) !== activeBucket) return false;
      if (!q) return true;
      const primary = modelSelectorPrimaryLine(m.id).toLowerCase();
      const tag = (getModelTypeTag(m.id) || '').toLowerCase();
      return primary.includes(q) || m.id.toLowerCase().includes(q) || tag.includes(q);
    });
  });

  const grouped = $derived(groupModelsForSelector(filteredFlat));

  $effect(() => {
    if (models.length) ensureModelIcons(models.map((x) => x.id));
  });

  $effect(() => {
    if (!panelOpen || !enableSearch) return;
    searchQuery = '';
    activeBucket = 'all';
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

  function toggleGroup(bucket) {
    collapsed = { ...collapsed, [bucket]: !collapsed[bucket] };
  }

  function chipCount(bucket) {
    if (bucket === 'all') return models.length;
    return allGrouped.find((g) => g.bucket === bucket)?.items.length ?? 0;
  }
</script>

{#if enableSearch}
  <div class="px-3 py-2 border-b sticky top-0 z-[3]" style="border-color: var(--ui-border); background-color: var(--ui-bg-main);">
    <input
      bind:this={searchEl}
      type="text"
      placeholder="Search name, id, or tag…"
      bind:value={searchQuery}
      onkeydown={onSearchKeydown}
      class="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
      style="background: color-mix(in srgb, var(--ui-border) 30%, transparent); color: var(--ui-text-primary);"
      aria-label="Search models"
    />
    {#if allGrouped.length > 1}
      <div class="flex flex-wrap gap-1 mt-2" role="tablist" aria-label="Filter by source">
        <button
          type="button"
          role="tab"
          aria-selected={activeBucket === 'all'}
          class="model-chip {activeBucket === 'all' ? 'model-chip-on' : ''}"
          onclick={() => (activeBucket = 'all')}
        >All {chipCount('all')}</button>
        {#each allGrouped as g (g.bucket)}
          <button
            type="button"
            role="tab"
            aria-selected={activeBucket === g.bucket}
            class="model-chip {activeBucket === g.bucket ? 'model-chip-on' : ''}"
            onclick={() => (activeBucket = g.bucket)}
          >{g.title} {g.items.length}</button>
        {/each}
      </div>
    {/if}
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
    {@const isCollapsed = !!collapsed[g.bucket]}
    <div class="model-provider-group" role="group" aria-labelledby={headerDomId(g.bucket)}>
      <button
        type="button"
        id={headerDomId(g.bucket)}
        class="model-provider-header px-3 py-2 z-[2] w-full text-left flex items-start gap-2"
        style="background-color: color-mix(in srgb, var(--ui-bg-sidebar) 88%, var(--ui-border)); border-bottom: 1px solid var(--ui-border);"
        onclick={() => toggleGroup(g.bucket)}
        aria-expanded={!isCollapsed}
      >
        <svg class="w-3 h-3 shrink-0 mt-0.5 transition-transform {isCollapsed ? '-rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
        <span class="min-w-0 flex-1">
          <span class="flex items-baseline gap-2">
            <span class="text-[11px] font-semibold uppercase tracking-wider" style="color: var(--ui-text-primary); letter-spacing: 0.05em;">
              {g.title}
            </span>
            <span class="text-[10px] font-mono" style="color: var(--ui-text-secondary);">{g.items.length}</span>
          </span>
          <span class="block text-[10px] mt-0.5 leading-snug" style="color: var(--ui-text-secondary);">
            {g.hint}
          </span>
        </span>
      </button>
      {#if !isCollapsed}
        {#each g.items as m (m.id)}
          {@const icon = getModelIcon(m.id, $modelIconOverrides)}
          {@const sub = modelSelectorSecondaryLine(m.id)}
          {@const tag = showTypeTags ? getModelTypeTag(m.id) : null}
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
                <span class="shrink-0 ml-auto flex items-center gap-1.5">
                  {#if tag}
                    <span
                      class="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style="background: color-mix(in srgb, var(--ui-accent) 12%, transparent); color: var(--ui-accent);"
                      >{tag}</span
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
      {/if}
    </div>
  {/each}
  <div class="px-3 py-1.5 text-[10px] sticky bottom-0" style="color: var(--ui-text-secondary); background-color: var(--ui-bg-main); border-top: 1px solid var(--ui-border);">
    {filteredFlat.length === models.length
      ? `${models.length} model${models.length === 1 ? '' : 's'}`
      : `${filteredFlat.length} of ${models.length} models`}
  </div>
{/if}

<style>
  .model-row:hover {
    background-color: color-mix(in srgb, var(--ui-border) 32%, transparent);
  }
  .model-row.model-row-selected {
    background-color: color-mix(in srgb, var(--ui-accent) 10%, transparent);
    box-shadow: inset 3px 0 0 var(--ui-accent);
  }
  .model-chip {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--ui-border);
    color: var(--ui-text-secondary);
    background: transparent;
  }
  .model-chip-on {
    color: var(--ui-accent);
    border-color: color-mix(in srgb, var(--ui-accent) 45%, var(--ui-border));
    background: color-mix(in srgb, var(--ui-accent) 12%, transparent);
  }
</style>
