<script>
  import ModelSelectorSlot from "$lib/components/ModelSelectorSlot.svelte";
  import { arenaSlotAIsJudge } from "$lib/stores.js";

  let { arenaPanelCount, running, arenaScores, windowWidth } = $props();

  const gridCols = $derived(
    windowWidth < 1200
      ? "repeat(2, minmax(0, 1fr))"
      : `repeat(${arenaPanelCount}, minmax(0, 1fr))`,
  );

  /** Slot accent for score text; running ring uses the same hue so “busy” reads as activity, not a second score. */
  const SLOT = /** @type {const} */ ({
    A: { score: "#2563eb", ring: "rgba(37, 99, 235, 0.55)", fill: "rgba(37, 99, 235, 0.07)" },
    B: { score: "#059669", ring: "rgba(5, 150, 105, 0.55)", fill: "rgba(5, 150, 105, 0.07)" },
    C: { score: "#d97706", ring: "rgba(217, 119, 6, 0.55)", fill: "rgba(217, 119, 6, 0.07)" },
    D: { score: "#7c3aed", ring: "rgba(124, 58, 237, 0.55)", fill: "rgba(124, 58, 237, 0.07)" },
  });
</script>

<!-- Sticky model strip: below app chrome, above command toolbar. z-20: above arena panels, below dropdowns (z-40+) and modals. -->
<header
  class="arena-model-strip shrink-0 grid gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 items-stretch relative border-b"
  style="background-color: var(--ui-bg-sidebar); border-color: color-mix(in srgb, var(--ui-border) 80%, transparent); grid-template-columns: {gridCols}; z-index: 20; box-shadow: 0 1px 0 color-mix(in srgb, var(--ui-border) 35%, transparent);"
>
  {#if arenaPanelCount >= 1}
    {@const s = SLOT.A}
    <div
      class="flex items-center gap-2 rounded-2xl px-2.5 sm:px-3 py-2 min-h-0 transition-all duration-200 border"
      style="
        border-color: color-mix(in srgb, var(--ui-border) 70%, transparent);
        background: {running.A ? s.fill : 'color-mix(in srgb, var(--ui-border) 9%, var(--ui-bg-main))'};
        box-shadow: {running.A ? `0 0 0 2px ${s.ring}, 0 4px 14px ${s.fill}` : 'none'};
      "
    >
      <div class="flex flex-col items-center gap-0.5 shrink-0 w-5" title={$arenaSlotAIsJudge ? "Slot A is the judge model" : "Contestant A"}>
        <span class="text-[10px] font-extrabold leading-none" style="color: var(--ui-text-secondary);">A</span>
        {#if $arenaSlotAIsJudge}
          <span
            class="text-[8px] font-extrabold leading-none px-1 py-px rounded"
            style="color: var(--ui-bg-main); background: var(--ui-accent);"
            aria-hidden="true">J</span
          >
        {/if}
      </div>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="A" compact={true} /></div>
      <span
        class="arena-header-score min-w-[2.25rem] text-center text-sm font-bold tabular-nums px-1 rounded-md"
        style="color: {s.score}; background: color-mix(in srgb, {s.score} 12%, transparent);"
        title="Cumulative score">{arenaScores.A ?? 0}</span>
    </div>
  {/if}
  {#if arenaPanelCount >= 2}
    {@const s = SLOT.B}
    <div
      class="flex items-center gap-2 rounded-2xl px-2.5 sm:px-3 py-2 min-h-0 transition-all duration-200 border"
      style="
        border-color: color-mix(in srgb, var(--ui-border) 70%, transparent);
        background: {running.B ? s.fill : 'color-mix(in srgb, var(--ui-border) 9%, var(--ui-bg-main))'};
        box-shadow: {running.B ? `0 0 0 2px ${s.ring}, 0 4px 14px ${s.fill}` : 'none'};
      "
    >
      <span class="text-[10px] font-extrabold w-5 text-center shrink-0" style="color: var(--ui-text-secondary);">B</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="B" compact={true} /></div>
      <span
        class="arena-header-score min-w-[2.25rem] text-center text-sm font-bold tabular-nums px-1 rounded-md"
        style="color: {s.score}; background: color-mix(in srgb, {s.score} 12%, transparent);"
        title="Cumulative score">{arenaScores.B}</span>
    </div>
  {/if}
  {#if arenaPanelCount >= 3}
    {@const s = SLOT.C}
    <div
      class="flex items-center gap-2 rounded-2xl px-2.5 sm:px-3 py-2 min-h-0 transition-all duration-200 border"
      style="
        border-color: color-mix(in srgb, var(--ui-border) 70%, transparent);
        background: {running.C ? s.fill : 'color-mix(in srgb, var(--ui-border) 9%, var(--ui-bg-main))'};
        box-shadow: {running.C ? `0 0 0 2px ${s.ring}, 0 4px 14px ${s.fill}` : 'none'};
      "
    >
      <span class="text-[10px] font-extrabold w-5 text-center shrink-0" style="color: var(--ui-text-secondary);">C</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="C" compact={true} /></div>
      <span
        class="arena-header-score min-w-[2.25rem] text-center text-sm font-bold tabular-nums px-1 rounded-md"
        style="color: {s.score}; background: color-mix(in srgb, {s.score} 12%, transparent);"
        title="Cumulative score">{arenaScores.C}</span>
    </div>
  {/if}
  {#if arenaPanelCount >= 4}
    {@const s = SLOT.D}
    <div
      class="flex items-center gap-2 rounded-2xl px-2.5 sm:px-3 py-2 min-h-0 transition-all duration-200 border"
      style="
        border-color: color-mix(in srgb, var(--ui-border) 70%, transparent);
        background: {running.D ? s.fill : 'color-mix(in srgb, var(--ui-border) 9%, var(--ui-bg-main))'};
        box-shadow: {running.D ? `0 0 0 2px ${s.ring}, 0 4px 14px ${s.fill}` : 'none'};
      "
    >
      <span class="text-[10px] font-extrabold w-5 text-center shrink-0" style="color: var(--ui-text-secondary);">D</span>
      <div class="flex-1 min-w-0"><ModelSelectorSlot slot="D" compact={true} /></div>
      <span
        class="arena-header-score min-w-[2.25rem] text-center text-sm font-bold tabular-nums px-1 rounded-md"
        style="color: {s.score}; background: color-mix(in srgb, {s.score} 12%, transparent);"
        title="Cumulative score">{arenaScores.D}</span>
    </div>
  {/if}
</header>
