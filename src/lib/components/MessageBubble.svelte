<script>
  import { renderMarkdown } from '$lib/markdown.js';
  import { fly } from 'svelte/transition';
  import { bounceOut } from 'svelte/easing';
  import PerfStats from '$lib/components/PerfStats.svelte';
  import { pinnedContent } from '$lib/stores.js';

  let { message } = $props();
  const isUser = $derived(message.role === 'user');
  const isAssistant = $derived(message.role === 'assistant');
  const content = $derived(typeof message.content === 'string' ? message.content : '');
  const contentArray = $derived(Array.isArray(message.content) ? message.content : []);
  const html = $derived(isAssistant && content ? renderMarkdown(content) : '');

  function copyContent() {
    const text = content || contentArray.map((p) => (p.type === 'text' ? p.text : '')).join('');
    if (text) navigator.clipboard?.writeText(text);
  }
  function pinContent() {
    const text = content || contentArray.map((p) => (p.type === 'text' ? p.text : '')).join('');
    if (text) pinnedContent.set(text);
  }
</script>

<div
  class="flex {isUser ? 'justify-end' : 'justify-start'}"
  in:fly={{ y: 56, duration: 1200, easing: bounceOut }}>
  <div
    class="max-w-[82%] rounded-2xl px-4 py-3 shadow-sm
      {isUser
      ? 'ui-user-bubble'
      : 'bg-white dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 border border-zinc-200/80 dark:border-zinc-700/80'}">
    {#if isUser}
      {#if contentArray.length}
        <div class="space-y-2">
          {#each contentArray as part}
            {#if part.type === 'text'}
              <p class="whitespace-pre-wrap">{part.text}</p>
            {:else if part.type === 'image_url'}
              <img
                src={part.image_url?.url}
                alt="Attached"
                class="max-w-full max-h-48 rounded object-contain" />
            {/if}
          {/each}
        </div>
      {:else}
        <p class="whitespace-pre-wrap">{content}</p>
      {/if}
    {:else if isAssistant}
      {#if message.modelId}
        <div class="flex items-center gap-1.5 mb-2 pb-2 border-b border-zinc-200/60 dark:border-zinc-600/60">
          <span class="text-xs font-medium text-zinc-500 dark:text-zinc-400 truncate" title={message.modelId}>{message.modelId}</span>
        </div>
      {/if}
      {#if !content}
        <div class="flex items-center py-1" aria-label="Thinking">
          <svg class="thinking-atom-icon w-8 h-8" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="3" class="thinking-atom-nucleus" />
            <ellipse cx="16" cy="16" rx="12" ry="5" stroke-width="1.5" opacity="0.9" class="thinking-atom-orbit" />
            <ellipse cx="16" cy="16" rx="12" ry="5" stroke-width="1.5" opacity="0.85" class="thinking-atom-orbit-2" />
            <ellipse cx="16" cy="16" rx="12" ry="5" stroke-width="1.5" opacity="0.85" class="thinking-atom-orbit-3" />
          </svg>
        </div>
      {:else}
        <div class="prose-chat prose dark:prose-invert max-w-none">
          {@html html}
        </div>
        <div class="flex items-center gap-1 mt-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-600/60">
          <button type="button" class="text-[10px] px-2 py-1 rounded border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors" style="color: var(--ui-text-secondary);" onclick={copyContent} title="Copy">Copy</button>
          <button type="button" class="text-[10px] px-2 py-1 rounded border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-colors" style="color: var(--ui-text-secondary);" onclick={pinContent} title="Pin to Workbench">Pin</button>
        </div>
        {#if message.stats || content}
          <PerfStats stats={message.stats} contentLength={content.length} elapsedMs={message.stats?.elapsed_ms} />
        {/if}
      {/if}
    {/if}
  </div>
</div>
