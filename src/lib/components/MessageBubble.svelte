<script>
  import { renderMarkdown, splitThinkingAndAnswer } from "$lib/markdown.js";
  import { fly } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import PerfStats from "$lib/components/PerfStats.svelte";
  import { pinnedContent } from "$lib/stores.js";

  let { message } = $props();
  const isUser = $derived(message.role === "user");
  const isAssistant = $derived(message.role === "assistant");
  const content = $derived(
    typeof message.content === "string" ? message.content : "",
  );
  const contentArray = $derived(
    Array.isArray(message.content) ? message.content : [],
  );
  const parts = $derived(
    isAssistant && content ? splitThinkingAndAnswer(content) : [],
  );
  const hasThinkingOrAnswer = $derived(parts.length > 0);
  const html = $derived(
    isAssistant && content && !hasThinkingOrAnswer
      ? renderMarkdown(content)
      : "",
  );

  let copyFeedback = $state(false);
  let pinFeedback = $state(false);

  function copyContent() {
    const text =
      content ||
      contentArray.map((p) => (p.type === "text" ? p.text : "")).join("");
    if (text) {
      navigator.clipboard?.writeText(text);
      copyFeedback = true;
      setTimeout(() => {
        copyFeedback = false;
      }, 1500);
    }
  }
  function pinContent() {
    const text =
      content ||
      contentArray.map((p) => (p.type === "text" ? p.text : "")).join("");
    if (text) {
      pinnedContent.set(text);
      pinFeedback = true;
      setTimeout(() => {
        pinFeedback = false;
      }, 1500);
    }
  }
</script>

<div
  class="flex {isUser ? 'justify-end' : 'justify-start'}"
  in:fly={{ y: 20, duration: 380, easing: quintOut }}
>
  <div
    class="max-w-full rounded-2xl px-4 py-3 shadow-sm
      {isUser
      ? 'ui-user-bubble'
      : 'bg-white dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 border border-zinc-200/80 dark:border-zinc-700/80'}"
  >
    {#if isUser}
      {#if contentArray.length}
        <div class="space-y-2">
          {#each contentArray as part}
            {#if part.type === "text"}
              <p class="whitespace-pre-wrap">{part.text}</p>
            {:else if part.type === "image_url"}
              <img
                src={part.image_url?.url}
                alt="Attached"
                class="max-w-full max-h-48 rounded object-contain"
              />
            {/if}
          {/each}
        </div>
      {:else}
        <p class="whitespace-pre-wrap">{content}</p>
      {/if}
    {:else if isAssistant}
      {#if message.modelId}
        <div
          class="flex items-center gap-1.5 mb-2 pb-2 border-b border-zinc-200/60 dark:border-zinc-600/60"
        >
          <span
            class="text-xs font-medium text-zinc-500 dark:text-zinc-400 truncate"
            title={message.modelId}>{message.modelId}</span
          >
        </div>
      {/if}
      {#if !content}
        <div class="flex items-center py-1" aria-label="Thinking">
          <svg
            class="thinking-atom-icon w-8 h-8"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="16" cy="16" r="3" class="thinking-atom-nucleus" />
            <ellipse
              cx="16"
              cy="16"
              rx="10"
              ry="4"
              class="thinking-atom-orbit"
            />
            <ellipse
              cx="16"
              cy="16"
              rx="12"
              ry="5"
              class="thinking-atom-orbit-2"
            />
            <ellipse
              cx="16"
              cy="16"
              rx="11"
              ry="4.5"
              class="thinking-atom-orbit-3"
            />
          </svg>
        </div>
      {:else}
        {#if hasThinkingOrAnswer}
          <div class="prose-chat prose dark:prose-invert max-w-none space-y-3">
            {#each parts as part}
              <div
                class:assistant-thinking={part.type === "thinking"}
                class:assistant-answer={part.type === "answer"}
              >
                {@html part.html}
              </div>
            {/each}
          </div>
        {:else}
          <div class="prose-chat prose dark:prose-invert max-w-none">
            {@html html}
          </div>
        {/if}
        <div
          class="flex items-center gap-1 mt-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-600/60"
        >
          <!-- Copy button with clipboard icon -->
          <button
            type="button"
            class="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-all duration-200"
            style="color: {copyFeedback
              ? 'var(--ui-accent, #22c55e)'
              : 'var(--ui-text-secondary)'};"
            onclick={copyContent}
            title={copyFeedback ? "Copied!" : "Copy to clipboard"}
          >
            {#if copyFeedback}
              <!-- Checkmark icon -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><polyline points="20 6 9 17 4 12"></polyline></svg
              >
              <span>Copied!</span>
            {:else}
              <!-- Clipboard icon -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><rect x="9" y="9" width="13" height="13" rx="2" ry="2"
                ></rect><path
                  d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                ></path></svg
              >
            {/if}
          </button>
          <!-- Pin button with pin icon -->
          <button
            type="button"
            class="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 transition-all duration-200"
            style="color: {pinFeedback
              ? 'var(--ui-accent, #22c55e)'
              : 'var(--ui-text-secondary)'};"
            onclick={pinContent}
            title={pinFeedback ? "Pinned!" : "Pin to Workbench"}
          >
            {#if pinFeedback}
              <!-- Checkmark icon -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><polyline points="20 6 9 17 4 12"></polyline></svg
              >
              <span>Pinned!</span>
            {:else}
              <!-- Pin icon -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><line x1="12" y1="17" x2="12" y2="22"></line><path
                  d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"
                ></path></svg
              >
            {/if}
          </button>
        </div>
        {#if message.stats || content}
          <PerfStats
            stats={message.stats}
            contentLength={content.length}
            elapsedMs={message.stats?.elapsed_ms}
          />
        {/if}
      {/if}
    {/if}
  </div>
</div>
