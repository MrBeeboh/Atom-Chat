<script>
  import { fly } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import {
    floatingMetricsOpen,
    floatingMetricsMinimized,
    floatingMetricsPosition,
    floatingMetricsSize,
    tokSeries,
    liveTokPerSec,
    lastResponseTokPerSec,
    hardwareMetrics,
  } from '$lib/stores.js';
  import { get } from 'svelte/store';
  import { fetchHardwareMetrics } from '$lib/api.js';

  const MIN_W = 200;
  const MAX_W = 500;
  const MIN_H = 160;
  const MAX_H = 420;

  let pos = $state({ x: 24, y: 24 });
  let size = $state({ width: 220, height: 260 });
  let dragStart = $state(null);
  /** Resize: { handle: 'n'|'s'|'e'|'w'|'nw'|'ne'|'sw'|'se', startX, startY, startW, startH, startPosX, startPosY } */
  let resizeStart = $state(null);

  $effect(() => {
    const unsubP = floatingMetricsPosition.subscribe((p) => {
      pos = p ? { x: p.x, y: p.y } : { x: 24, y: 24 };
    });
    const unsubS = floatingMetricsSize.subscribe((s) => {
      size = s ? { width: s.width, height: s.height } : { width: 220, height: 260 };
    });
    return () => { unsubP(); unsubS(); };
  });

  function startDrag(e) {
    if (e.button !== 0) return;
    dragStart = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }
  function onMove(e) {
    if (!dragStart) return;
    const panelW = $floatingMetricsMinimized ? 200 : size.width;
    const panelH = $floatingMetricsMinimized ? 36 : size.height;
    const x = Math.max(0, Math.min(e.clientX - dragStart.x, window.innerWidth - panelW));
    const y = Math.max(0, Math.min(e.clientY - dragStart.y, window.innerHeight - panelH));
    floatingMetricsPosition.set({ x, y });
  }
  function endDrag() {
    dragStart = null;
  }

  function startResize(e, handle) {
    if (e.button !== 0) return;
    e.stopPropagation();
    resizeStart = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height,
      startPosX: pos.x,
      startPosY: pos.y,
    };
  }
  function onResizeMove(e) {
    if (!resizeStart) return;
    const dx = e.clientX - resizeStart.startX;
    const dy = e.clientY - resizeStart.startY;
    let w = resizeStart.startW;
    let h = resizeStart.startH;
    let x = resizeStart.startPosX;
    let y = resizeStart.startPosY;
    if (resizeStart.handle.includes('e')) w = Math.min(MAX_W, Math.max(MIN_W, resizeStart.startW + dx));
    if (resizeStart.handle.includes('w')) {
      const newW = Math.min(MAX_W, Math.max(MIN_W, resizeStart.startW - dx));
      x = resizeStart.startPosX + (resizeStart.startW - newW);
      w = newW;
    }
    if (resizeStart.handle.includes('s')) h = Math.min(MAX_H, Math.max(MIN_H, resizeStart.startH + dy));
    if (resizeStart.handle.includes('n')) {
      const newH = Math.min(MAX_H, Math.max(MIN_H, resizeStart.startH - dy));
      y = resizeStart.startPosY + (resizeStart.startH - newH);
      h = newH;
    }
    floatingMetricsSize.set({ width: w, height: h });
    floatingMetricsPosition.set({ x, y });
  }
  function endResize() {
    resizeStart = null;
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    if (dragStart) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', endDrag);
      return () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', endDrag);
      };
    }
    if (resizeStart) {
      document.addEventListener('mousemove', onResizeMove);
      document.addEventListener('mouseup', endResize);
      return () => {
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', endResize);
      };
    }
  });

  const w = 200;
  const h = 72;
  /** Fixed time window: always show this many samples (e.g. 60 = last 60 seconds at 1 sample/s). X-axis scrolls; no compression. */
  const TIME_WINDOW_SAMPLES = 60;
  /** Unified 0–100% series: each point { tok, vram, gpu, ram, cpu }. Kept to 2× window so we have scroll headroom. */
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
          ...unifiedSeries.slice(-(TIME_WINDOW_SAMPLES * 2 - 1)),
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

  /** Always plot last TIME_WINDOW_SAMPLES so x-scale is fixed and the line scrolls (newest right, oldest drops off left). */
  const seriesToPlot = $derived(unifiedSeries.length ? unifiedSeries.slice(-TIME_WINDOW_SAMPLES) : []);

  /** Map last N points to 0..w so oldest is left, newest right; spacing is constant so line stays lean and scrolls. */
  const pathFor = (key) => {
    if (!seriesToPlot.length) return '';
    const n = seriesToPlot.length;
    return seriesToPlot
      .map((p, i) => {
        const x = (n > 1 ? i / (n - 1) : 0) * w;
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

  /** Y-axis grid: finer (10% steps) when panel is tall, else 25% steps. Reacts to panel height. */
  const yGridPcts = $derived(size.height > 180 ? [10, 20, 30, 40, 50, 60, 70, 80, 90] : [25, 50, 75]);
  /** X-axis grid: finer (10% time steps) when panel is wide, else 25%. Reacts to panel width. */
  const xGridPcts = $derived(size.width > 280 ? [10, 20, 30, 40, 50, 60, 70, 80, 90] : [25, 50, 75]);

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
      width: {$floatingMetricsMinimized ? '200px' : size.width + 'px'};
      height: {$floatingMetricsMinimized ? '36px' : size.height + 'px'};
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
      <div class="p-2 border-t border-zinc-200/60 dark:border-zinc-700/60 min-h-0 flex-1 overflow-auto flex flex-col gap-1.5" style="border-color: var(--ui-border);">
        <div class="flex items-center justify-between gap-2 shrink-0">
          <span class="text-[10px] uppercase text-zinc-500 dark:text-zinc-400">All 0–100%</span>
          <span class="text-[9px] text-zinc-400 dark:text-zinc-500">Tok · VRAM · GPU · RAM · CPU</span>
        </div>
        <!-- Graph fills resized panel; content adapts: wider = more samples (time), taller = finer Y grid -->
        <div class="relative flex-1 min-h-[72px] w-full" role="img" aria-label="Metrics graph (time vs 0–100%)">
          <svg viewBox="0 0 200 72" preserveAspectRatio="none" class="block w-full h-full" style="min-height: 72px; overflow: visible;">
            <defs>
              <style>
                .metrics-axis { stroke: var(--metrics-axis, #d4d4d4); stroke-width: 1; }
                .metrics-grid { stroke: var(--metrics-grid, #e5e5e5); stroke-width: 0.5; }
              </style>
            </defs>
            <!-- Y axis (left): 0–100% -->
            <line x1="0" y1="0" x2="0" y2="72" class="metrics-axis" />
            <!-- X axis (bottom): time -->
            <line x1="0" y1="72" x2="200" y2="72" class="metrics-axis" />
            <!-- Horizontal grid: finer (e.g. 10%) when panel is tall -->
            {#each yGridPcts as pct}
              <line x1="0" y1={72 * (1 - pct / 100)} x2="200" y2={72 * (1 - pct / 100)} class="metrics-grid" />
            {/each}
            <!-- Vertical grid: finer when panel is wide (more time divisions) -->
            {#each xGridPcts as pct}
              <line x1={200 * pct / 100} y1="0" x2={200 * pct / 100} y2="72" class="metrics-grid" />
            {/each}
            <!-- Data lines: thin strokes so the graph stays lean; x-axis is fixed window (scrolls, no compression) -->
            <polyline fill="none" stroke="var(--atom-teal)" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round" points={pathTok} />
            <polyline fill="none" stroke="var(--atom-amber, #f59e0b)" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round" points={pathVram} />
            <polyline fill="none" stroke="#ef4444" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round" points={pathGpu} />
            <polyline fill="none" stroke="#3b82f6" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round" points={pathRam} />
            <polyline fill="none" stroke="#22c55e" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round" points={pathCpu} />
          </svg>
        </div>
        <p class="text-[9px] text-zinc-400 dark:text-zinc-500 shrink-0">Y: 0–100% · X: last {TIME_WINDOW_SAMPLES}s (scrolls, newest right)</p>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[10px] uppercase text-zinc-500 dark:text-zinc-400">Tokens/s</span>
          <span class="text-sm font-mono font-semibold" style="color: var(--atom-teal);">
            {$liveTokPerSec != null ? $liveTokPerSec.toFixed(1) : $lastResponseTokPerSec != null ? $lastResponseTokPerSec.toFixed(1) : '—'}
          </span>
        </div>
        <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] font-mono pt-1 border-t shrink-0" style="border-color: var(--ui-border);">
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
          <p class="text-[9px] text-zinc-400 dark:text-zinc-500 pt-0.5 shrink-0" style="border-color: var(--ui-border);">Start <code class="px-0.5 rounded opacity-80" style="background: var(--ui-input-bg);">python scripts/hardware_server.py</code> to fill above</p>
        {/if}
      </div>
      <!-- Resize handles (edges and corners) -->
      <div class="absolute left-0 top-0 w-full h-1.5 cursor-n-resize z-10" style="height: 6px;" onmousedown={(e)=>startResize(e,'n')} title="Resize" aria-hidden="true"></div>
      <div class="absolute right-0 top-0 bottom-0 w-1.5 cursor-e-resize z-10" style="width: 6px;" onmousedown={(e)=>startResize(e,'e')} title="Resize" aria-hidden="true"></div>
      <div class="absolute left-0 right-0 bottom-0 h-1.5 cursor-s-resize z-10" style="height: 6px;" onmousedown={(e)=>startResize(e,'s')} title="Resize" aria-hidden="true"></div>
      <div class="absolute left-0 top-0 bottom-0 w-1.5 cursor-w-resize z-10" style="width: 6px;" onmousedown={(e)=>startResize(e,'w')} title="Resize" aria-hidden="true"></div>
      <div class="absolute left-0 top-0 w-2 h-2 cursor-nwse-resize z-10" style="width: 10px; height: 10px;" onmousedown={(e)=>startResize(e,'nw')} title="Resize" aria-hidden="true"></div>
      <div class="absolute right-0 top-0 w-2 h-2 cursor-nesw-resize z-10" style="width: 10px; height: 10px;" onmousedown={(e)=>startResize(e,'ne')} title="Resize" aria-hidden="true"></div>
      <div class="absolute left-0 bottom-0 w-2 h-2 cursor-nesw-resize z-10" style="width: 10px; height: 10px;" onmousedown={(e)=>startResize(e,'sw')} title="Resize" aria-hidden="true"></div>
      <div class="absolute right-0 bottom-0 w-2 h-2 cursor-nwse-resize z-10" style="width: 10px; height: 10px;" onmousedown={(e)=>startResize(e,'se')} title="Resize" aria-hidden="true"></div>
    {/if}
  </div>
{/if}
