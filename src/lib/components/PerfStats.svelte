<script>
  let { stats, contentLength = 0, elapsedMs: propElapsedMs } = $props();
  const completion = $derived(stats?.completion_tokens ?? Math.max(1, Math.ceil(contentLength / 4)));
  const elapsedMs = $derived(stats?.elapsed_ms ?? propElapsedMs ?? 0);
  const elapsedSec = $derived(elapsedMs / 1000);
  const tokensPerSec = $derived(elapsedSec > 0 ? (completion / elapsedSec).toFixed(1) : '—');
  const promptTokens = $derived(stats?.prompt_tokens ?? 0);
  const isEstimated = $derived(stats?.estimated ?? !stats?.completion_tokens);
</script>

<div class="mt-3 pt-3 border-t border-zinc-200/80 dark:border-zinc-600/80 flex flex-wrap items-center gap-2">
  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-700/80 text-xs font-medium text-zinc-600 dark:text-zinc-300">
    <span class="text-blue-600 dark:text-blue-400 font-semibold">{tokensPerSec}</span> tok/s
  </span>
  {#if completion}
    <span class="text-xs text-zinc-500 dark:text-zinc-400">{completion} tokens</span>
  {/if}
  {#if promptTokens}
    <span class="text-xs text-zinc-500 dark:text-zinc-400">{promptTokens} prompt</span>
  {/if}
  {#if elapsedMs}
    <span class="text-xs text-zinc-500 dark:text-zinc-400">{elapsedMs}ms</span>
  {/if}
  {#if isEstimated}
    <span class="text-xs text-zinc-400 dark:text-zinc-500">(est.)</span>
  {/if}
</div>
