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
    hardwareMetrics,
  } from '$lib/stores.js';
  import { get } from 'svelte/store';
  import { fetchHardwareMetrics } from '$lib/api.js';

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
    const panelH = $floatingMetricsMinimized ? 36 : 260;
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

  const UNIFIED_MAX = 60;
  const w = 200;
  const h = 72;
  /** Unified 0–100% series: each point { tok, vram, gpu, ram, cpu } for same time index */
  let unifiedSeries = $state([]);

  $effect(() => {
    let cancelled = false;
    function tick() {
      if (cancelled) return;
      if (!get(floatingMetricsOpen) || get(floatingMetricsMinimized)) return;
      const tok = get(liveTokPerSec) ?? get(lastResponseTokPerSec) ?? 0;
      fetchHardwareMetrics().then((m) => {
        if (cancelled) return;
        hardwareMetrics.set(m);
        const vramPct = m && m.vram_total_gb > 0 ? (m.vram_used_gb / m.vram_total_gb) * 100 : 0;
        const ramPct = m && m.ram_total_gb > 0 ? (m.ram_used_gb / m.ram_total_gb) * 100 : 0;
        unifiedSeries = [
          ...unifiedSeries.slice(-(UNIFIED_MAX - 1)),
          {
            tok: Math.min(100, Number(tok)),
            vram: vramPct,
            gpu: m ? m.gpu_util : 0,
            ram: ramPct,
            cpu: m ? m.cpu_percent : 0,
          },
        ];
      });
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  });

  const pathFor = (key) => {
    if (!unifiedSeries.length) return '';
    return unifiedSeries
      .map((p, i) => {
        const x = (i / Math.max(1, unifiedSeries.length - 1)) * w;
        const v = Math.min(100, Math.max(0, p[key] ?? 0));
        const y = h - (v / 100) * h;
        return `${x},${y}`;
      })
      .join(' ');
  };
  let hoveredIdx = $state(-1);
  const pathTok = $derived(pathFor('tok'));
  const pathVram = $derived(pathFor('vram'));
  const pathGpu = $derived(pathFor('gpu'));
  const pathRam = $derived(pathFor('ram'));
  const pathCpu = $derived(pathFor('cpu'));

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
      <div class="p-2 border-t border-zinc-200/60 dark:border-zinc-700/60 space-y-1.5" style="border-color: var(--ui-border);">
        <div class="flex items-center justify-between gap-2 mb-0.5">
          <span class="text-[10px] uppercase text-zinc-500 dark:text-zinc-400">All 0–100%</span>
          <span class="text-[9px] text-zinc-400 dark:text-zinc-500">Tok · VRAM · GPU · RAM · CPU</span>
        </div>
        <div class="relative" role="img" aria-label="Metrics graph (time vs 0–100%)">
          <svg width={w} height={h} class="block" style="overflow: visible;">
            <defs>
              <style>
                .metrics-axis { stroke: var(--metrics-axis, #d4d4d4); stroke-width: 1; }
                .metrics-grid { stroke: var(--metrics-grid, #e5e5e5); stroke-width: 0.5; }
              </style>
            </defs>
            <!-- Y axis (left): 0–100% -->
            <line x1="0" y1="0" x2="0" y2={h} class="metrics-axis" />
            <!-- X axis (bottom): time -->
            <line x1="0" y1={h} x2={w} y2={h} class="metrics-axis" />
            <!-- Horizontal grid (25%, 50%, 75%) -->
            <line x1="0" y1={h * 0.25} x2={w} y2={h * 0.25} class="metrics-grid" />
            <line x1="0" y1={h * 0.5} x2={w} y2={h * 0.5} class="metrics-grid" />
            <line x1="0" y1={h * 0.75} x2={w} y2={h * 0.75} class="metrics-grid" />
            <!-- Vertical grid (25%, 50%, 75% of time) -->
            <line x1={w * 0.25} y1="0" x2={w * 0.25} y2={h} class="metrics-grid" />
            <line x1={w * 0.5} y1="0" x2={w * 0.5} y2={h} class="metrics-grid" />
            <line x1={w * 0.75} y1="0" x2={w * 0.75} y2={h} class="metrics-grid" />
            <!-- Data lines (on top of grid) -->
            <polyline fill="none" stroke="var(--atom-teal)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points={pathTok} />
            <polyline fill="none" stroke="var(--atom-amber, #f59e0b)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" points={pathVram} />
            <polyline fill="none" stroke="#ef4444" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" points={pathGpu} />
            <polyline fill="none" stroke="#3b82f6" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" points={pathRam} />
            <polyline fill="none" stroke="#22c55e" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" points={pathCpu} />
          </svg>
          <p class="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">Y: 0–100% · X: time (newest right)</p>
        </div>
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[10px] uppercase text-zinc-500 dark:text-zinc-400">Tokens/s</span>
          <span class="text-sm font-mono font-semibold" style="color: var(--atom-teal);">
            {$liveTokPerSec != null ? $liveTokPerSec.toFixed(1) : $lastResponseTokPerSec != null ? $lastResponseTokPerSec.toFixed(1) : '—'}
          </span>
        </div>
        <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] font-mono pt-1 border-t" style="border-color: var(--ui-border);">
          <span class="uppercase text-zinc-500 dark:text-zinc-400">VRAM</span>
          <span class="truncate" style="color: var(--atom-amber, #f59e0b);">{$hardwareMetrics ? `${$hardwareMetrics.vram_used_gb} / ${$hardwareMetrics.vram_total_gb} GB` : '—'}</span>
          <span class="uppercase text-zinc-500 dark:text-zinc-400">GPU</span>
          <span class="truncate" style="color: var(--atom-amber, #f59e0b);">{$hardwareMetrics ? $hardwareMetrics.gpu_util + '%' : '—'}</span>
          <span class="uppercase text-zinc-500 dark:text-zinc-400">Sys RAM</span>
          <span class="truncate" style="color: var(--atom-blue, #3b82f6);">{$hardwareMetrics ? `${$hardwareMetrics.ram_used_gb} / ${$hardwareMetrics.ram_total_gb} GB` : '—'}</span>
          <span class="uppercase text-zinc-500 dark:text-zinc-400">CPU</span>
          <span class="truncate" style="color: var(--atom-teal);">{$hardwareMetrics ? $hardwareMetrics.cpu_percent + '%' : '—'}</span>
        </div>
        {#if !$hardwareMetrics}
          <p class="text-[9px] text-zinc-400 dark:text-zinc-500 pt-0.5" style="border-color: var(--ui-border);">Start <code class="px-0.5 rounded opacity-80" style="background: var(--ui-input-bg);">python scripts/hardware_server.py</code> to fill above</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}
