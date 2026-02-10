<script>
  import { fly } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import {
    floatingMetricsOpen,
    floatingMetricsMinimized,
    floatingMetricsPosition,
    tokSeries,
    liveTokPerSec,
    lastResponseTokPerSec,
  } from '$lib/stores.js';

  let pos = $state({ x: 24, y: 24 });
  let dragStart = $state(null);

  $effect(() => {
    const unsub = floatingMetricsPosition.subscribe((p) => {
      pos = p ? { x: p.x, y: p.y } : { x: 24, y: 24 };
    });
    return () => unsub();
  });

  function startDrag(e) {
    if (e.button !== 0) return;
    dragStart = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }
  function onMove(e) {
    if (!dragStart) return;
    const panelW = $floatingMetricsMinimized ? 200 : 220;
    const panelH = $floatingMetricsMinimized ? 36 : 140;
    const x = Math.max(0, Math.min(e.clientX - dragStart.x, window.innerWidth - panelW));
    const y = Math.max(0, Math.min(e.clientY - dragStart.y, window.innerHeight - panelH));
    floatingMetricsPosition.set({ x, y });
  }
  function endDrag() {
    dragStart = null;
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    if (!dragStart) return;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', endDrag);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', endDrag);
    };
  });

  let hoveredIdx = $state(-1);
  let seriesArr = $state([]);
  $effect(() => {
    const unsub = tokSeries.subscribe((v) => (seriesArr = Array.isArray(v) ? v : []));
    return () => unsub();
  });
  const maxVal = $derived(Math.max(1, ...seriesArr));
  const w = 180;
  const h = 56;
  const pathPoints = $derived.by(() => {
    if (!seriesArr.length) return '';
    return seriesArr
      .map((v, i) => {
        const x = (i / Math.max(1, seriesArr.length - 1)) * w;
        const y = h - (Number(v) / maxVal) * h;
        return `${x},${y}`;
      })
      .join(' ');
  });

  function toggleMinimize() {
    floatingMetricsMinimized.update((v) => !v);
  }
  function closePanel() {
    floatingMetricsOpen.set(false);
  }
</script>

{#if !$floatingMetricsOpen}
  <button
    type="button"
    class="fixed z-40 bottom-6 right-6 rounded-lg border-2 p-3 text-xl shadow-lg transition-opacity hover:opacity-90"
    style="border-color: var(--ui-border); background-color: var(--ui-bg-sidebar); color: var(--ui-text-secondary);"
    onclick={() => floatingMetricsOpen.set(true)}
    title="Open Metrics"
    aria-label="Open Metrics panel"
  >
    📊
  </button>
{/if}

{#if $floatingMetricsOpen}
  <div
    class="fixed z-40 rounded-xl border shadow-lg flex flex-col overflow-hidden atom-layout-transition select-none"
    class:atom-streaming-glow={$liveTokPerSec != null}
    style="
      left: {pos.x}px;
      top: {pos.y}px;
      width: {$floatingMetricsMinimized ? '200px' : '220px'};
      height: {$floatingMetricsMinimized ? '36px' : 'auto'};
      background-color: var(--ui-bg-sidebar);
      border-color: var(--ui-border);
    "
    role="region"
    aria-label="Metrics dashboard"
    in:fly={{ x: 220, duration: 400, easing: backOut }}
    out:fly={{ x: 220, duration: 300, easing: quintOut }}
  >
    <div
      class="flex items-center justify-between gap-2 px-2 py-1.5 cursor-grab active:cursor-grabbing border-b shrink-0"
      style="border-color: var(--ui-border); color: var(--ui-text-secondary);"
      onmousedown={startDrag}
      role="button"
      tabindex="0"
      onkeydown={(e) => e.key === 'Enter' && startDrag({ button: 0, clientX: pos.x, clientY: pos.y })}
    >
      <span class="text-xs font-medium uppercase tracking-wide">Metrics</span>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          onclick={(e) => { e.stopPropagation(); toggleMinimize(); }}
          aria-label="{$floatingMetricsMinimized ? 'Expand' : 'Minimize'}"
        >
          {$floatingMetricsMinimized ? '⊕' : '−'}
        </button>
        <button
          type="button"
          class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-base leading-none"
          onclick={(e) => { e.stopPropagation(); closePanel(); }}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </div>
    </div>
    {#if !$floatingMetricsMinimized}
      <div class="p-2 border-t border-zinc-200/60 dark:border-zinc-700/60" style="border-color: var(--ui-border);">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-[10px] uppercase text-zinc-500 dark:text-zinc-400">tok/s</span>
          <span class="text-sm font-mono font-semibold" style="color: var(--atom-teal);">
            {$liveTokPerSec != null ? $liveTokPerSec.toFixed(1) : $lastResponseTokPerSec != null ? $lastResponseTokPerSec.toFixed(1) : '—'}
          </span>
        </div>
        <div class="relative" role="img" aria-label="Tokens per second sparkline">
          <svg
            width={w}
            height={h}
            class="block"
            role="img"
            onmousemove={(e) => {
              if (!seriesArr.length) { hoveredIdx = -1; return; }
              const rect = e.currentTarget.getBoundingClientRect();
              const xRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / w));
              hoveredIdx = Math.round(xRatio * (seriesArr.length - 1));
            }}
            onmouseleave={() => (hoveredIdx = -1)}>
            <polyline
              fill="none"
              stroke="var(--atom-teal)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              points={pathPoints}
            />
            {#if hoveredIdx >= 0 && hoveredIdx < seriesArr.length}
              {@const hx = (hoveredIdx / Math.max(1, seriesArr.length - 1)) * w}
              {@const hy = h - (Number(seriesArr[hoveredIdx]) / maxVal) * h}
              <circle cx={hx} cy={hy} r="3" fill="var(--atom-teal)" />
            {/if}
          </svg>
          {#if hoveredIdx >= 0 && hoveredIdx < seriesArr.length}
            {@const hx = (hoveredIdx / Math.max(1, seriesArr.length - 1)) * w}
            <div
              class="absolute pointer-events-none rounded px-1.5 py-0.5 text-[10px] font-mono whitespace-nowrap shadow"
              style="left: {Math.min(hx, w - 50)}px; bottom: {h + 4}px; background: var(--ui-bg-main); color: var(--atom-teal); border: 1px solid var(--ui-border);">
              {Number(seriesArr[hoveredIdx]).toFixed(1)} t/s
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}
