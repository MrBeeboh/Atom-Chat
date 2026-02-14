<script>
  import ModelSelectorSlot from "$lib/components/ModelSelectorSlot.svelte";

  let { arenaPanelCount, running, arenaScores, windowWidth } = $props();

  const gridCols = $derived(
    windowWidth < 1200
      ? "repeat(2, minmax(0, 1fr))"
      : `repeat(${arenaPanelCount}, minmax(0, 1fr))`
  );
</script>

<header
  class="shrink-0 grid gap-2 px-3 py-1.5 border-b items-stretch"
  style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border); z-index: 100; grid-template-columns: {gridCols};"
>
  {#if arenaPanelCount >= 1}
    <div
      class="flex items-center gap-2 rounded-lg border-2 px-2.5 py-1.5 min-h-0 transition-all"
      class:model-card-active={running.A}
      style="background-color: var(--ui-bg-main); border-color: {running.A ? '#3b82f6' : 'var(--ui-border)'};"
    >
      <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">A</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="A" /></div>
      <span class="arena-header-score min-w-[2.25rem] text-center text-sm font-extrabold tabular-nums px-1.5 py-0.5 rounded" style="color: #3b82f6; background: color-mix(in srgb, #3b82f6 14%, transparent);">{arenaScores.A ?? 0}</span>
    </div>
  {/if}
  {#if arenaPanelCount >= 2}
    <div
      class="flex items-center gap-2 rounded-lg border-2 px-2.5 py-1.5 min-h-0 transition-all"
      class:model-card-active={running.B}
      style="background-color: var(--ui-bg-main); border-color: {running.B ? '#10b981' : 'var(--ui-border)'};"
    >
      <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">B</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="B" /></div>
      <span class="arena-header-score min-w-[2.25rem] text-center text-sm font-extrabold tabular-nums px-1.5 py-0.5 rounded" style="color: #10b981; background: color-mix(in srgb, #10b981 14%, transparent);">{arenaScores.B}</span>
    </div>
  {/if}
  {#if arenaPanelCount >= 3}
    <div
      class="flex items-center gap-2 rounded-lg border-2 px-2.5 py-1.5 min-h-0 transition-all"
      class:model-card-active={running.C}
      style="background-color: var(--ui-bg-main); border-color: {running.C ? '#f59e0b' : 'var(--ui-border)'};"
    >
      <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">C</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="C" /></div>
      <span class="arena-header-score min-w-[2.25rem] text-center text-sm font-extrabold tabular-nums px-1.5 py-0.5 rounded" style="color: #f59e0b; background: color-mix(in srgb, #f59e0b 14%, transparent);">{arenaScores.C}</span>
    </div>
  {/if}
  {#if arenaPanelCount >= 4}
    <div
      class="flex items-center gap-2 rounded-lg border-2 px-2.5 py-1.5 min-h-0 transition-all"
      class:model-card-active={running.D}
      style="background-color: var(--ui-bg-main); border-color: {running.D ? '#8b5cf6' : 'var(--ui-border)'};"
    >
      <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">D</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="D" /></div>
      <span class="arena-header-score min-w-[2.25rem] text-center text-sm font-extrabold tabular-nums px-1.5 py-0.5 rounded" style="color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 14%, transparent);">{arenaScores.D}</span>
    </div>
  {/if}
</header>
