<script>
  import {
    contextUsage,
    summarizeAndContinueTrigger,
    isStreaming,
  } from '$lib/stores.js';

  let { inline = false } = $props();

  function triggerSummarize() {
    if ($isStreaming) return;
    summarizeAndContinueTrigger.update((n) => n + 1);
  }

  const radius = 10;
  const stroke = 2.5;
  const circumference = 2 * Math.PI * radius;

  const used = $derived($contextUsage.promptTokens);
  const max = $derived($contextUsage.contextMax > 0 ? $contextUsage.contextMax : 0);
  const ratio = $derived(max > 0 ? Math.min(1, used / max) : 0);
  const dashOffset = $derived(circumference * (1 - ratio));
  const isHigh = $derived(ratio >= 0.7);
  const isFull = $derived(ratio >= 0.9);
  const pct = $derived(Math.round(ratio * 100));
  const usedLabel = $derived(used >= 1000 ? `${(used / 1000).toFixed(1)}k` : String(used));
  const maxLabel = $derived(max >= 1000 ? `${(max / 1000).toFixed(0)}k` : max ? String(max) : '?');
</script>

<button
  type="button"
  class={[
    'context-ring-button rounded-full flex items-center justify-center shrink-0 focus:outline-none',
    inline && 'context-ring-inline',
    isFull && 'context-ring-full',
    isHigh && !isFull && 'context-ring-high',
  ]}
  style="width: 24px; height: 24px;"
  title={max
    ? `${usedLabel} / ${maxLabel} tokens (${pct}%)${isHigh ? '. Click to compress earlier turns.' : ''}`
    : 'Context window'}
  aria-label={max
    ? `Context ${pct} percent, ${usedLabel} of ${maxLabel} tokens`
    : 'Context window'}
  disabled={$isStreaming}
  onclick={() => isHigh && triggerSummarize()}
>
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    class="rotate-[-90deg]"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r={radius}
      fill="none"
      stroke="currentColor"
      stroke-width={stroke}
      opacity="0.2"
    />
    {#if used > 0 && max > 0}
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="currentColor"
        stroke-width={stroke}
        stroke-dasharray={circumference}
        stroke-dashoffset={dashOffset}
        stroke-linecap="round"
        class="transition-[stroke-dashoffset] duration-300"
      />
    {/if}
  </svg>
</button>

<style>
  .context-ring-button {
    color: var(--ui-text-secondary);
  }
  .context-ring-button:hover:not(:disabled) {
    color: var(--ui-accent);
  }
  .context-ring-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--ui-accent);
  }
  .context-ring-button:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .context-ring-button.context-ring-inline {
    color: var(--context-ring-color, var(--ui-accent, #0d9488));
  }
  .context-ring-button.context-ring-high {
    color: var(--ui-accent-hot, #d97706);
  }
  .context-ring-button.context-ring-full {
    color: var(--ui-accent-hot, #dc2626);
  }
</style>
