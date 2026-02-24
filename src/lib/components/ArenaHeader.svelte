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
  class="shrink-0 grid gap-2 px-3 py-2 items-stretch"
  style="background-color: var(--ui-bg-sidebar); z-index: 100; grid-template-columns: {gridCols};"
>
  {#if arenaPanelCount >= 1}
    <div
      class="flex items-center gap-2 rounded-xl px-3 py-2 min-h-0 transition-all"
      class:model-card-active={running.A}
      style="background: {running.A ? 'color-mix(in srgb, #3b82f6 10%, var(--ui-bg-main))' : 'color-mix(in srgb, var(--ui-border) 12%, var(--ui-bg-main))'};"
    >
      <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">A</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="A" /></div>
      <span class="arena-header-score min-w-[2rem] text-center text-sm font-bold tabular-nums" style="color: #3b82f6;">{arenaScores.A ?? 0}</span>
    </div>
  {/if}
  {#if arenaPanelCount >= 2}
    <div
      class="flex items-center gap-2 rounded-xl px-3 py-2 min-h-0 transition-all"
      class:model-card-active={running.B}
      style="background: {running.B ? 'color-mix(in srgb, #10b981 10%, var(--ui-bg-main))' : 'color-mix(in srgb, var(--ui-border) 12%, var(--ui-bg-main))'};"
    >
      <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">B</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="B" /></div>
      <span class="arena-header-score min-w-[2rem] text-center text-sm font-bold tabular-nums" style="color: #10b981;">{arenaScores.B}</span>
    </div>
  {/if}
  {#if arenaPanelCount >= 3}
    <div
      class="flex items-center gap-2 rounded-xl px-3 py-2 min-h-0 transition-all"
      class:model-card-active={running.C}
      style="background: {running.C ? 'color-mix(in srgb, #f59e0b 10%, var(--ui-bg-main))' : 'color-mix(in srgb, var(--ui-border) 12%, var(--ui-bg-main))'};"
    >
      <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">C</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="C" /></div>
      <span class="arena-header-score min-w-[2rem] text-center text-sm font-bold tabular-nums" style="color: #f59e0b;">{arenaScores.C}</span>
    </div>
  {/if}
  {#if arenaPanelCount >= 4}
    <div
      class="flex items-center gap-2 rounded-xl px-3 py-2 min-h-0 transition-all"
      class:model-card-active={running.D}
      style="background: {running.D ? 'color-mix(in srgb, #8b5cf6 10%, var(--ui-bg-main))' : 'color-mix(in srgb, var(--ui-border) 12%, var(--ui-bg-main))'};"
    >
      <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">D</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="D" /></div>
      <span class="arena-header-score min-w-[2rem] text-center text-sm font-bold tabular-nums" style="color: #8b5cf6;">{arenaScores.D}</span>
    </div>
  {/if}
</header>
