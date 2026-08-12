<script>
  import ModelSelectorSlot from "$lib/components/ModelSelectorSlot.svelte";

  let { arenaPanelCount, running, arenaScores, windowWidth } = $props();

  const gridCols = $derived(
    windowWidth < 1200
      ? "repeat(2, minmax(0, 1fr))"
      : `repeat(${arenaPanelCount}, minmax(0, 1fr))`
  );

  const SLOT_COLORS = { A: '#3b82f6', B: '#10b981', C: '#f59e0b', D: '#8b5cf6' };
</script>

<header
  class="shrink-0 grid gap-2 px-3 py-2 items-stretch"
  style="background-color: var(--ui-bg-sidebar); border-bottom: 1px solid var(--ui-border); z-index: 100; grid-template-columns: {gridCols};"
>
  {#each ['A', 'B', 'C', 'D'].slice(0, arenaPanelCount) as slot}
    {@const color = SLOT_COLORS[slot]}
    {@const isRunning = running[slot]}
    <div
      class="flex items-center gap-2 rounded-xl px-3 py-2 min-h-0 transition-all"
      class:model-card-active={isRunning}
      style="background: {isRunning ? `color-mix(in srgb, ${color} 12%, var(--ui-bg-main))` : 'color-mix(in srgb, var(--ui-border) 12%, var(--ui-bg-main))'}; border: 1px solid {isRunning ? `color-mix(in srgb, ${color} 30%, transparent)` : 'var(--ui-border)'};"
    >
      <span class="text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center shrink-0" style="background: color-mix(in srgb, {color} 15%, transparent); color: {color};">{slot}</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot {slot} /></div>
      <span class="arena-header-score min-w-[2rem] text-center text-sm font-bold tabular-nums" style="color: {color};">{arenaScores[slot] ?? 0}</span>
    </div>
  {/each}
</header>
