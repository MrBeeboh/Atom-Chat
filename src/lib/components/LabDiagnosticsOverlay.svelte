<script>
  import { fade } from 'svelte/transition';
  import { themeMetrics } from '$lib/stores.js';
  import { getLabPerformanceConfig } from '$lib/labPerformanceGuard.js';

  const config = getLabPerformanceConfig();
  const showWhenCompactMs = 2000;

  let compactVisible = $state(false);
  /** Non-reactive so writing it does not re-trigger the effect (avoids effect_update_depth_exceeded). */
  let compactTimeoutId = null;

  $effect(() => {
    const m = $themeMetrics;
    if (m.isStreaming) {
      if (compactTimeoutId) {
        clearTimeout(compactTimeoutId);
        compactTimeoutId = null;
      }
      compactVisible = false;
    } else {
      if (m.lastLatencyMs != null) compactVisible = true;
      if (compactTimeoutId) clearTimeout(compactTimeoutId);
      compactTimeoutId = setTimeout(() => {
        compactVisible = false;
        compactTimeoutId = null;
      }, showWhenCompactMs);
    }
    return () => {
      if (compactTimeoutId) clearTimeout(compactTimeoutId);
      compactTimeoutId = null;
    };
  });

  const visible = $derived($themeMetrics.isStreaming || compactVisible);
  const isLive = $derived($themeMetrics.isStreaming);
</script>

{#if visible}
  <div
  in:fade={{ duration: 200 }}
  out:fade={{ duration: 250 }}
  class="lab-overlay"
    class:lab-overlay--live={isLive}
    class:lab-overlay--compact={!isLive}
    style="
      --lab-blur: {config.blurIntensity * 8}px;
      transition: opacity var(--duration-normal) var(--ease-out),
        transform var(--duration-normal) var(--ease-out);
    "
  >
    <div class="lab-overlay__glass">
      {#if isLive}
        <div class="lab-overlay__row">
          <span class="lab-overlay__label">Streaming</span>
          <span class="lab-overlay__value">{$themeMetrics.liveChunks} chunks</span>
        </div>
        <div class="lab-overlay__row">
          <span class="lab-overlay__label">Chunks/s</span>
          <span class="lab-overlay__value">{$themeMetrics.liveChunksPerSec.toFixed(1)}</span>
        </div>
        {#if $themeMetrics.temperature != null}
          <div class="lab-overlay__row">
            <span class="lab-overlay__label">Temp</span>
            <span class="lab-overlay__value">{$themeMetrics.temperature}</span>
          </div>
        {/if}
      {:else}
        <div class="lab-overlay__row">
          <span class="lab-overlay__label">Latency</span>
          <span class="lab-overlay__value">{$themeMetrics.lastLatencyMs != null ? Math.round($themeMetrics.lastLatencyMs) + ' ms' : '—'}</span>
        </div>
        <div class="lab-overlay__row">
          <span class="lab-overlay__label">Tokens</span>
          <span class="lab-overlay__value">{$themeMetrics.lastTotalTokens ?? '—'}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .lab-overlay {
    position: fixed;
    bottom: var(--space-4);
    right: var(--space-4);
    z-index: 100;
    pointer-events: none;
  }
  .lab-overlay__glass {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--ui-border);
    background: color-mix(in srgb, var(--ui-bg-sidebar) 92%, transparent);
    -webkit-backdrop-filter: blur(var(--lab-blur, 8px));
    backdrop-filter: blur(var(--lab-blur, 8px));
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    color: var(--ui-text-secondary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  .lab-overlay--compact .lab-overlay__glass {
    padding: var(--space-1.5) var(--space-2);
  }
  .lab-overlay__row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    line-height: 1.4;
  }
  .lab-overlay__row + .lab-overlay__row {
    margin-top: var(--space-1);
  }
  .lab-overlay__label {
    color: var(--ui-text-secondary);
  }
  .lab-overlay__value {
    color: var(--ui-text-primary);
    font-variant-numeric: tabular-nums;
  }
</style>
