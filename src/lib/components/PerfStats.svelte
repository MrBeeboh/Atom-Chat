<script>
  let { stats, contentLength = 0, elapsedMs: propElapsedMs } = $props();
  const completion = $derived(stats?.completion_tokens ?? Math.max(1, Math.ceil(contentLength / 4)));
  const elapsedMs = $derived(stats?.elapsed_ms ?? propElapsedMs ?? 0);
  const elapsedSec = $derived(elapsedMs / 1000);
  const tokensPerSec = $derived(elapsedSec > 0 ? (completion / elapsedSec).toFixed(1) : '—');
  const promptTokens = $derived(stats?.prompt_tokens ?? 0);
  const isEstimated = $derived(stats?.estimated ?? !stats?.completion_tokens);
</script>

<div class="mt-3 pt-3 flex flex-wrap items-center gap-2" style="border-top: 1px solid var(--ui-border);">
  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style="background: color-mix(in srgb, var(--ui-border) 40%, transparent); color: var(--ui-text-secondary);">
    <span class="font-semibold" style="color: var(--ui-accent);">{tokensPerSec}</span> tok/s
  </span>
  {#if completion}
    <span class="text-xs" style="color: var(--ui-text-secondary);">{completion} tokens</span>
  {/if}
  {#if promptTokens}
    <span class="text-xs" style="color: var(--ui-text-secondary);">{promptTokens} prompt</span>
  {/if}
  {#if elapsedMs}
    <span class="text-xs" style="color: var(--ui-text-secondary);">{elapsedMs}ms</span>
  {/if}
  {#if isEstimated}
    <span class="text-xs" style="color: var(--ui-text-secondary); opacity: 0.7;">(est.)</span>
  {/if}
</div>
