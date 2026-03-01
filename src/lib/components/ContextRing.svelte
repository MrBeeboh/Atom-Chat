<script>
  import {
    contextUsage,
    summarizeAndContinueTrigger,
    settings,
  } from "$lib/stores.js";

  let { inline = false } = $props();

  function triggerSummarize() {
    summarizeAndContinueTrigger.update((n) => n + 1);
  }

  const radius = 10;
  const stroke = 2.5;
  const circumference = 2 * Math.PI * radius;

  const used = $derived($contextUsage.promptTokens);
  const storeMax = $derived($contextUsage.contextMax || 128000);
  const userMax = $derived(Number($settings?.context_length) || 0);
  const max = $derived(userMax > 0 ? userMax : storeMax);
  const ratio = $derived(Math.min(1, used / max));
  const dashOffset = $derived(circumference * (1 - ratio));
  const isHigh = $derived(ratio >= 0.85);
  const isFull = $derived(ratio >= 1);
  const label = $derived(
    used >= 1000 ? `${(used / 1000).toFixed(1)}K` : String(used),
  );
  const maxLabel = $derived(
    max >= 1000 ? `${(max / 1000).toFixed(0)}K` : String(max),
  );
</script>

<button
  type="button"
  class="context-ring-button rounded-full flex items-center justify-center shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
  class:context-ring-inline={inline}
  style="width: 24px; height: 24px;"
  title="{used} / {maxLabel} tokens{isHigh
    ? ' — Click to summarize and continue'
    : ''}"
  aria-label="Context used: {used} of {maxLabel} tokens. {isHigh
    ? 'Summarize and continue'
    : ''}"
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
    {#if used > 0}
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
        style={isFull ? "opacity: 1;" : isHigh ? "opacity: 0.9;" : ""}
      />
    {/if}
  </svg>
</button>

<style>
  .context-ring-button {
    color: var(--ui-text-secondary);
  }
  .context-ring-button:hover {
    color: var(--ui-accent);
  }
  .context-ring-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--ui-accent);
  }
  .context-ring-button.context-ring-inline {
    color: var(--context-ring-color, #0d9488);
  }
  .context-ring-button.context-ring-inline:hover {
    color: var(--context-ring-hover, #0f766e);
  }
  :global(.dark) .context-ring-button.context-ring-inline {
    color: var(--context-ring-color, #2dd4bf);
  }
  :global(.dark) .context-ring-button.context-ring-inline:hover {
    color: var(--context-ring-hover, #5eead4);
  }
</style>
