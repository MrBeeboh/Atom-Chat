<script>
  /**
   * DashboardPerf: Performance dashboard for Arena score history.
   * Summary cards, bar charts (avg score, avg tok/s), line (score trend), scatter (speed vs quality), ArenaScoreMatrix table.
   * Pure inline SVG charts; data from localStorage arenaScoreHistory.
   */
  import { onMount } from 'svelte';
  import {
    loadScoreHistory,
    computeTotals,
    computeAverageScores,
    computeAverageTps,
    getUniqueModels,
  } from '$lib/arenaLogic.js';
  import ArenaScoreMatrix from '$lib/components/ArenaScoreMatrix.svelte';

  let scoreHistory = $state([]);

  const SLOT_COLORS = {
    B: 'var(--ui-accent)',
    C: 'var(--ui-accent-cool, var(--ui-accent))',
    D: 'var(--ui-accent-hot, var(--ui-accent))',
  };
  const SLOT_ORDER = ['B', 'C', 'D'];

  const totals = $derived(computeTotals(scoreHistory));
  const avgScores = $derived(computeAverageScores(scoreHistory));
  const avgTps = $derived(computeAverageTps(scoreHistory));
  const uniqueModels = $derived(getUniqueModels(scoreHistory));

  const visibleSlots = $derived(SLOT_ORDER.filter((s) => scoreHistory.some((r) => r.scores[s] != null)));

  const totalQuestions = $derived(scoreHistory.length);
  const modelCount = $derived(visibleSlots.length);
  const bestSlot = $derived(
    visibleSlots.length === 0
      ? null
      : visibleSlots.reduce((a, b) => ((avgScores[a] ?? 0) >= (avgScores[b] ?? 0) ? a : b)),
  );
  const fastestSlot = $derived(
    visibleSlots.length === 0
      ? null
      : visibleSlots.reduce((a, b) => ((avgTps[a] ?? 0) >= (avgTps[b] ?? 0) ? a : b)),
  );

  const hasData = $derived(scoreHistory.length > 0);

  const scoreBarMax = $derived(10);
  const tpsBarMax = $derived(Math.max(1, ...visibleSlots.map((s) => avgTps[s] ?? 0), 60));

  onMount(() => {
    scoreHistory = loadScoreHistory();
  });

  function refresh() {
    scoreHistory = loadScoreHistory();
  }

  const modelIdBySlot = $derived.by(() => {
    const out = {};
    for (let i = scoreHistory.length - 1; i >= 0; i--) {
      const ids = scoreHistory[i]?.modelIds;
      if (!ids || typeof ids !== 'object') continue;
      for (const slot of SLOT_ORDER) {
        if (out[slot]) continue;
        const v = ids[slot];
        if (typeof v === 'string' && v.trim()) out[slot] = v.trim();
      }
      if (SLOT_ORDER.every((s) => out[s])) break;
    }
    return out;
  });

  function labelForSlot(slot) {
    const id = modelIdBySlot?.[slot];
    return id ? String(id) : `Slot ${slot}`;
  }

  function slotColor(slot) {
    return SLOT_COLORS[slot] || 'var(--ui-accent)';
  }

  function softBarBg(slot) {
    return `color-mix(in srgb, ${slotColor(slot)} 14%, var(--ui-border))`;
  }

  function scoreColor(score) {
    if (score == null) return 'var(--ui-text-secondary)';
    if (score >= 7) return 'var(--ui-accent-cool, var(--ui-accent))';
    if (score >= 4) return 'var(--ui-accent)';
    return 'var(--ui-accent-hot, var(--ui-accent))';
  }
</script>

<div class="dashboard-perf flex flex-col gap-4 p-4 max-w-6xl mx-auto" style="color: var(--ui-text-primary);">
  <div class="flex items-baseline justify-between flex-wrap gap-3">
    <div class="min-w-[240px]">
      <h1 class="text-[18px] font-semibold leading-tight" style="color: var(--ui-text-primary);">Performance</h1>
      <div class="text-[11px] mt-0.5" style="color: var(--ui-text-secondary);">Arena history (stored locally)</div>
    </div>
    <button type="button" class="ui-btn-ghost text-xs" onclick={refresh}>Refresh</button>
  </div>

  {#if !hasData}
    <p class="text-sm py-4" style="color: var(--ui-text-secondary);">
      No score history yet. Run questions in Arena; scores are recorded automatically when all models finish. Return here to see charts and summaries.
    </p>
  {:else}
    <!-- Summary cards -->
    <section class="grid grid-cols-2 md:grid-cols-4 gap-2" aria-label="Summary">
      <div class="perf-card">
        <div class="perf-k">Questions scored</div>
        <div class="perf-v">{totalQuestions}</div>
      </div>
      <div class="perf-card">
        <div class="perf-k">Models tested</div>
        <div class="perf-v">{modelCount}</div>
      </div>
      <div class="perf-card">
        <div class="perf-k">Best (avg score)</div>
        <div class="text-[12px] font-semibold leading-snug" style="color: var(--ui-text-primary);">
          {bestSlot ? labelForSlot(bestSlot) : '—'}
          {#if bestSlot && avgScores[bestSlot] != null}
            <span class="tabular-nums font-medium" style="color: var(--ui-text-secondary);"> ({avgScores[bestSlot].toFixed(1)})</span>
          {/if}
        </div>
        {#if bestSlot && modelIdBySlot[bestSlot]}
          <div class="perf-sub" style="color: var(--ui-text-secondary);">Slot {bestSlot}</div>
        {/if}
      </div>
      <div class="perf-card">
        <div class="perf-k">Fastest (avg tok/s)</div>
        <div class="text-[12px] font-semibold leading-snug" style="color: var(--ui-text-primary);">
          {fastestSlot ? labelForSlot(fastestSlot) : '—'}
          {#if fastestSlot && avgTps[fastestSlot] != null}
            <span class="tabular-nums font-medium" style="color: var(--ui-text-secondary);"> ({avgTps[fastestSlot].toFixed(1)})</span>
          {/if}
        </div>
        {#if fastestSlot && modelIdBySlot[fastestSlot]}
          <div class="perf-sub" style="color: var(--ui-text-secondary);">Slot {fastestSlot}</div>
        {/if}
      </div>
    </section>

    <section class="perf-panel" aria-label="Slot to model mapping">
      <div class="perf-panel-head">
        <h2 class="perf-h">Models in this dashboard</h2>
        <div class="perf-hint">slot → model id</div>
      </div>
      <div class="perf-model-map">
        {#each visibleSlots as slot}
          <div class="perf-model-row">
            <div class="perf-slot" style="border-color: {slotColor(slot)}; color: {slotColor(slot)};">{slot}</div>
            <div class="perf-model-id" style="color: var(--ui-text-primary);">
              {modelIdBySlot[slot] ? modelIdBySlot[slot] : '—'}
            </div>
          </div>
        {/each}
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-2" aria-label="Charts (bars)">
      <!-- Bar: Average Score per Model -->
      <section class="perf-panel" aria-label="Average score per model">
        <div class="perf-panel-head">
          <h2 class="perf-h">Average score</h2>
          <div class="perf-hint">0–10</div>
        </div>
        <div class="perf-rows">
          {#each visibleSlots as slot}
            {@const score = avgScores[slot] ?? 0}
            {@const pct = Math.max(0, Math.min(100, (score / scoreBarMax) * 100))}
            <div class="perf-row">
              <div class="perf-label">
                <div class="perf-slot" style="border-color: {slotColor(slot)}; color: {slotColor(slot)};">{slot}</div>
                {#if modelIdBySlot[slot]}
                  <div class="perf-sub">{modelIdBySlot[slot]}</div>
                {/if}
              </div>
              <div class="perf-bar" style="background: {softBarBg(slot)};">
                <div class="perf-bar-fill" style="width: {pct}%; background: {scoreColor(score)};"></div>
              </div>
              <div class="perf-num tabular-nums">{score.toFixed(1)}</div>
            </div>
          {/each}
        </div>
      </section>

      <!-- Bar: Average tok/s per Model -->
      <section class="perf-panel" aria-label="Average tokens per second per model">
        <div class="perf-panel-head">
          <h2 class="perf-h">Average speed</h2>
          <div class="perf-hint">tok/s</div>
        </div>
        <div class="perf-rows">
          {#each visibleSlots as slot}
            {@const tps = avgTps[slot] ?? 0}
            {@const pct = tpsBarMax > 0 ? Math.max(0, Math.min(100, (tps / tpsBarMax) * 100)) : 0}
            <div class="perf-row">
              <div class="perf-label">
                <div class="perf-slot" style="border-color: {slotColor(slot)}; color: {slotColor(slot)};">{slot}</div>
                {#if modelIdBySlot[slot]}
                  <div class="perf-sub">{modelIdBySlot[slot]}</div>
                {/if}
              </div>
              <div class="perf-bar" style="background: {softBarBg(slot)};">
                <div class="perf-bar-fill" style="width: {pct}%; background: {slotColor(slot)};"></div>
              </div>
              <div class="perf-num tabular-nums">{tps.toFixed(1)}</div>
            </div>
          {/each}
        </div>
      </section>
    </section>

    <!-- Line: Score Trend by Question -->
    <section class="perf-panel" aria-label="Score trend by question">
      <div class="perf-panel-head">
        <h2 class="perf-h">Score trend</h2>
        <div class="perf-hint">per question</div>
      </div>
      <div class="line-chart-container" style="min-height: 200px;">
        {#if totalQuestions > 0}
          {@const padding = { top: 10, right: 20, bottom: 30, left: 36 }}
          {@const w = 360}
          {@const h = 180}
          {@const graphW = w - padding.left - padding.right}
          {@const stepX = totalQuestions > 1 ? graphW / (totalQuestions - 1) : 0}
          {@const x0 = padding.left}
          {@const yScale = 10 > 0 ? (h - padding.top - padding.bottom) / 10 : 0}
          <svg class="w-full" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Line chart of score trend">
          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + h - padding.bottom} stroke="var(--ui-border)" stroke-width="1" />
          <line x1={padding.left} y1={padding.top + h - padding.bottom} x2={padding.left + w - padding.right} y2={padding.top + h - padding.bottom} stroke="var(--ui-border)" stroke-width="1" />
          {#each [0, 2, 4, 6, 8, 10] as val}
            <line x1={padding.left} y1={padding.top + h - padding.bottom - val * yScale} x2={padding.left + w - padding.right} y2={padding.top + h - padding.bottom - val * yScale} stroke="var(--ui-border)" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.6" />
            <text x={padding.left - 4} y={padding.top + h - padding.bottom - val * yScale + 4} text-anchor="end" class="text-xs" fill="var(--ui-text-secondary)">{val}</text>
          {/each}
          {#each visibleSlots as slot}
            {@const points = scoreHistory.map((r, i) => ({ i, y: r.scores[slot] })).filter((p) => p.y != null)}
            {#if points.length > 0}
              <polyline points={points.map((p) => `${x0 + p.i * stepX},${padding.top + h - padding.bottom - (p.y ?? 0) * yScale}`).join(' ')} fill="none" stroke={slotColor(slot)} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              {#each points as p}
                <circle cx={x0 + p.i * stepX} cy={padding.top + h - padding.bottom - (p.y ?? 0) * yScale} r="3" fill={slotColor(slot)} />
              {/each}
            {/if}
          {/each}
          {#each scoreHistory as round, i}
            {@const x = x0 + i * stepX}
            <text x={x} y={padding.top + h - padding.bottom + 14} text-anchor="middle" class="text-xs" fill="var(--ui-text-secondary)">Q{round.questionIndex + 1}</text>
          {/each}
          </svg>
        {/if}
      </div>
    </section>

    <!-- Scatter: Speed vs Quality -->
    <section class="perf-panel" aria-label="Speed vs quality scatter">
      <div class="perf-panel-head">
        <h2 class="perf-h">Speed vs quality</h2>
        <div class="perf-hint">one point per model</div>
      </div>
      <p class="text-xs mb-2" style="color: var(--ui-text-secondary);">Top-right = best (high score, high tok/s). One point per model.</p>
      <div class="scatter-container" style="min-height: 220px;">
        {#if visibleSlots.length > 0}
          {@const pad = { top: 20, right: 20, bottom: 40, left: 44 }}
          {@const sw = 320}
          {@const sh = 180}
          {@const maxTps = Math.max(1, ...visibleSlots.map((s) => avgTps[s] ?? 0), 60)}
          {@const scaleX = maxTps > 0 ? (sw - pad.left - pad.right) / maxTps : 0}
          {@const scaleY = 10 > 0 ? (sh - pad.top - pad.bottom) / 10 : 0}
          <svg class="w-full" viewBox="0 0 380 220" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Scatter plot speed vs quality">
          <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + sh - pad.bottom} stroke="var(--ui-border)" stroke-width="1" />
          <line x1={pad.left} y1={pad.top + sh - pad.bottom} x2={pad.left + sw - pad.right} y2={pad.top + sh - pad.bottom} stroke="var(--ui-border)" stroke-width="1" />
          <text x={pad.left + (sw - pad.left - pad.right) / 2} y={pad.top + sh - 8} text-anchor="middle" class="text-xs" fill="var(--ui-text-secondary)">Avg tok/s</text>
          <text x="12" y={pad.top + (sh - pad.top - pad.bottom) / 2 + 6} text-anchor="middle" class="text-xs" fill="var(--ui-text-secondary)" transform="rotate(-90 12 {pad.top + (sh - pad.top - pad.bottom) / 2 + 6})">Avg score</text>
          {#each visibleSlots as slot}
            {@const tps = avgTps[slot] ?? 0}
            {@const score = avgScores[slot] ?? 0}
            {@const cx = pad.left + tps * scaleX}
            {@const cy = pad.top + sh - pad.bottom - score * scaleY}
            <circle cx={cx} cy={cy} r="10" fill={slotColor(slot)} opacity="0.85" />
            <title>{modelIdBySlot[slot] ? `${slot}: ${modelIdBySlot[slot]}\nScore ${score.toFixed(1)} / 10\nSpeed ${tps.toFixed(1)} tok/s` : `${slot}: Score ${score.toFixed(1)} / 10, Speed ${tps.toFixed(1)} tok/s`}</title>
            <text x={cx} y={cy - 14} text-anchor="middle" class="text-xs font-semibold" fill={slotColor(slot)}>{slot}</text>
          {/each}
          </svg>
        {/if}
      </div>
    </section>

    <!-- Detailed table -->
    <section class="perf-panel" aria-label="Score matrix table">
      <div class="perf-panel-head">
        <h2 class="perf-h">Score breakdown</h2>
        {#if uniqueModels.length > 0}
          <div class="perf-hint">{uniqueModels.length} model(s)</div>
        {:else}
          <div class="perf-hint">—</div>
        {/if}
      </div>
      <ArenaScoreMatrix {scoreHistory} {totals} {visibleSlots} />
    </section>
  {/if}
</div>

<style>
  .perf-panel {
    border: 1px solid color-mix(in srgb, var(--ui-border) 75%, transparent);
    background: color-mix(in srgb, var(--ui-bg-sidebar) 65%, transparent);
    border-radius: 16px;
    padding: 14px;
  }

  .perf-panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .perf-h {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ui-text-primary);
    line-height: 1.2;
  }

  .perf-hint {
    font-size: 0.75rem;
    color: var(--ui-text-secondary);
  }

  .perf-card {
    border: 1px solid color-mix(in srgb, var(--ui-border) 70%, transparent);
    background: color-mix(in srgb, var(--ui-bg-sidebar) 55%, transparent);
    border-radius: 16px;
    padding: 12px 12px 10px;
    min-height: 64px;
  }

  .perf-k {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--ui-text-secondary);
  }

  .perf-v {
    margin-top: 2px;
    font-size: 1.1rem;
    font-weight: 650;
    color: var(--ui-text-primary);
    font-variant-numeric: tabular-nums;
  }

  .perf-sub {
    margin-top: 4px;
    font-size: 0.75rem;
    color: var(--ui-text-secondary);
    overflow-wrap: anywhere;
    word-break: break-word;
    white-space: normal;
  }

  .perf-model-map {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .perf-model-row {
    display: grid;
    grid-template-columns: 30px 1fr;
    gap: 12px;
    align-items: start;
  }

  .perf-model-id {
    font-size: 0.75rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .perf-rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .perf-row {
    display: grid;
    grid-template-columns: minmax(120px, 1.35fr) 3fr minmax(52px, 0.6fr);
    gap: 12px;
    align-items: center;
  }

  .perf-label {
    min-width: 0;
  }

  .perf-slot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 20px;
    border-radius: 999px;
    border: 1px solid;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
  }

  .perf-bar {
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
  }

  .perf-bar-fill {
    height: 100%;
    border-radius: 999px;
  }

  .perf-num {
    text-align: right;
    font-size: 0.75rem;
    color: var(--ui-text-secondary);
  }

  @media (max-width: 520px) {
    .perf-row {
      grid-template-columns: minmax(120px, 1.35fr) 2.2fr minmax(46px, 0.6fr);
    }
  }
</style>
