<script>
  import { renderMarkdown, splitThinkingAndAnswer } from "$lib/markdown.js";
  import { fly } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import { get } from "svelte/store";
  import PerfStats from "$lib/components/PerfStats.svelte";
  import AuthVideo from "$lib/components/AuthVideo.svelte";
  import { pinnedContent, deepinfraApiKey, isStreaming } from "$lib/stores.js";
  import { modelDisplayName } from "$lib/api.js";
  import ThinkingAtom from "$lib/components/ThinkingAtom.svelte";

  const modelLabel = $derived(
    message.modelId ? modelDisplayName(message.modelId) : "",
  );

  /** DeepInfra key: init from store + env so it's there on first paint; subscribe to stay in sync with Settings. */
  let deepinfraKey = $state(
    (
      get(deepinfraApiKey)?.trim() ||
      (typeof import.meta !== "undefined" &&
        import.meta.env?.VITE_DEEPINFRA_API_KEY) ||
      ""
    ).trim(),
  );
  $effect(() => {
    const unsub = deepinfraApiKey.subscribe((v) => {
      const k =
        (typeof v === "string" ? v : "").trim() ||
        (
          (typeof import.meta !== "undefined" &&
            import.meta.env?.VITE_DEEPINFRA_API_KEY) ||
          ""
        ).trim();
      deepinfraKey = k;
    });
    return () => unsub();
  });

  let {
    message,
    isLast = false,
    onRegenerate = null,
    onEditResend = null,
    onDelete = null,
  } = $props();
  const isUser = $derived(message.role === "user");
  const isAssistant = $derived(message.role === "assistant");
  const content = $derived(
    typeof message.content === "string" ? message.content : "",
  );
  const contentArray = $derived(
    Array.isArray(message.content) ? message.content : [],
  );
  const imageRefs = $derived(
    Array.isArray(message.imageRefs) ? message.imageRefs : [],
  );
  const imageUrls = $derived(
    Array.isArray(message.imageUrls) ? message.imageUrls : [],
  );
  const videoUrls = $derived(
    Array.isArray(message.videoUrls) ? message.videoUrls : [],
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
  const imageThumbUrls = $derived(
    isAssistant && content && content.includes("[Image: http")
      ? Array.from(content.matchAll(/\[Image: (https?:\/\/[^\]]+)\]/g)).map(
          (m) => m[1],
        )
      : [],
  );

  let copyFeedback = $state(false);
  let pinFeedback = $state(false);

  /** Inline edit & resend (text-only user messages). */
  let editing = $state(false);
  let editText = $state("");
  const canEdit = $derived(
    isUser && typeof message.content === "string" && !!onEditResend,
  );
  const canRegenerate = $derived(isLast && !!onRegenerate);
  function startEdit() {
    editText = content;
    editing = true;
  }
  function cancelEdit() {
    editing = false;
  }
  function saveEdit() {
    const t = editText.trim();
    editing = false;
    if (!t || t === content.trim()) return;
    onEditResend?.(message, t);
  }
  function onEditKeydown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }
  /** Svelte action: focus the edit textarea with the caret at the end. */
  function autofocus(node) {
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }

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
  class="flex {isUser ? 'justify-end' : 'justify-start'} w-full max-w-[44rem]"
  in:fly={{ y: 20, duration: 380, easing: quintOut }}
>
  <div
    class="message-bubble-inner group relative overflow-hidden
      {isUser ? 'ui-user-bubble max-w-[85%] rounded-[10px] px-3 py-2' : 'atom-assistant w-full px-3 py-1'}"
    style={isUser ? '' : 'color: var(--ui-text-primary);'}
  >
    <!-- No background div here; handled by CSS below -->

    {#if isUser}
      {#if editing}
        <div class="flex flex-col gap-2" style="width: min(34rem, 70vw);">
          <textarea
            bind:value={editText}
            use:autofocus
            onkeydown={onEditKeydown}
            rows={Math.min(8, Math.max(2, editText.split("\n").length))}
            class="w-full rounded-md px-2.5 py-2 text-sm resize-y"
            style="background: var(--ui-bg-main); color: var(--ui-text-primary); border: 1px solid var(--ui-border);"
            aria-label="Edit message"
          ></textarea>
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px]" style="color: var(--ui-text-secondary);"
              >Sending removes the replies after this message.</span
            >
            <div class="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                class="text-[11px] px-2.5 py-1 rounded border"
                style="border-color: var(--ui-border); color: var(--ui-text-secondary); background: transparent;"
                onclick={cancelEdit}>Cancel</button
              >
              <button
                type="button"
                class="text-[11px] px-2.5 py-1 rounded font-medium"
                style="background: var(--ui-accent); color: var(--ui-bg-main);"
                onclick={saveEdit}>Send</button
              >
            </div>
          </div>
        </div>
      {:else if contentArray.length}
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
      {#if videoUrls.length}
        <div class="mt-2 flex flex-col gap-2">
          {#each videoUrls as url (url)}
            <div class="rounded-lg overflow-hidden max-w-md">
              <video
                src={url}
                controls
                class="w-full max-h-64 object-contain rounded-lg"
                preload="metadata"
                aria-label="Attached video"
              >
                <track kind="captions" />
                Your browser does not support the video tag.
              </video>
            </div>
          {/each}
        </div>
      {/if}
    {:else if isAssistant}
      {#if modelLabel}
        <div
          class="flex items-center gap-1.5 mb-2 pb-2"
          style="border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 70%, transparent);"
        >
          <span
            class="text-[10px] font-semibold uppercase tracking-[0.14em] truncate"
            style="color: var(--ui-accent); opacity: 0.9;"
            title={message.modelId}>{modelLabel}</span
          >
        </div>
      {/if}
      {#if !content && $isStreaming}
        <div class="flex items-center gap-3 py-2" aria-label="Thinking">
          <ThinkingAtom size={32} />
          <span class="thinking-label text-xs font-medium" style="color: var(--ui-text-secondary);">Reasoning…</span>
        </div>
      {:else if !content}
        <div class="flex items-center gap-3 py-2" aria-label="Waiting">
          <ThinkingAtom size={24} />
          <span class="thinking-label text-xs font-medium" style="color: var(--ui-text-secondary);">Waiting…</span>
        </div>
      {:else if hasThinkingOrAnswer}
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
          {#if content && content.includes("[Image: http")}
            <div class="mt-2 flex flex-wrap gap-3">
              {#each imageThumbUrls as url}
                <img
                  src={url}
                  alt="Result image"
                  class="max-h-32 rounded" style="border: 1px solid var(--ui-border);"
                  loading="lazy"
                />
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      {#if isAssistant && imageRefs.length}
        <div
          class="mt-3 flex gap-2 overflow-x-auto pb-1 rounded-lg"
          role="list"
          aria-label="Searched images"
        >
          {#each imageRefs as ref (ref.image_id)}
            <div
              class="shrink-0 rounded overflow-hidden" style="border: 1px solid var(--ui-border); background-color: var(--ui-bg-sidebar);"
              role="listitem"
            >
              <img
                src={"https://cdn.x.ai/images?id=" +
                  ref.image_id +
                  "&size=" +
                  (ref.size === "SMALL" ? "SMALL" : "LARGE")}
                alt={"Searched image (ID: " + ref.image_id + ")"}
                class="max-h-48 w-auto object-contain"
                loading="lazy"
              />
              <p
                class="p-1.5 text-[10px] truncate max-w-[120px]" style="color: var(--ui-text-secondary);"
              >
                ID: {ref.image_id}
              </p>
            </div>
          {/each}
        </div>
      {/if}
      {#if isAssistant && imageUrls.length}
        <div
          class="mt-3 flex gap-2 overflow-x-auto pb-1 rounded-lg"
          role="list"
          aria-label="Generated images"
        >
          {#each imageUrls as url (url)}
            <div
              class="shrink-0 rounded overflow-hidden" style="border: 1px solid var(--ui-border); background-color: var(--ui-bg-sidebar);"
              role="listitem"
            >
              <img
                src={url}
                alt=""
                class="max-h-64 w-auto object-contain"
                loading="lazy"
              />
            </div>
          {/each}
        </div>
      {/if}
      {#if isAssistant && videoUrls.length}
        <div
          class="mt-3 flex flex-col gap-2"
          role="list"
          aria-label="Generated videos"
        >
          {#each videoUrls as url (url)}
            <div
              class="rounded overflow-hidden max-w-2xl" style="border: 1px solid var(--ui-border); background-color: var(--ui-bg-sidebar);"
              role="listitem"
            >
              <AuthVideo {url} apiKey={deepinfraKey} />
            </div>
          {/each}
        </div>
      {/if}
      {#if isAssistant && (content.includes("Generated image") || content.includes("Generated video")) && !imageUrls.length && !videoUrls.length}
        <p class="mt-2 text-sm text-amber-600 dark:text-amber-400">
          Media could not be loaded. Try generating again and ensure your
          DeepInfra API key is set in Settings.
        </p>
      {/if}
    {/if}

    <!-- Copy/Pin/Edit/Regenerate/Delete actions for ALL messages (User or Assistant) -->
    {#if !editing && ((isUser && (content || contentArray.length)) || (isAssistant && (content || hasThinkingOrAnswer)))}
      <div
        class="message-actions flex items-center gap-1 mt-2 pt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 {isUser ? 'justify-end' : ''}"
      >
        <!-- Copy button with clipboard icon -->
        <button
          type="button"
          class="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-all duration-200"
          style="border-color: var(--ui-border); color: {copyFeedback ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'}; background: transparent;"
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
          class="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-all duration-200"
          style="border-color: var(--ui-border); color: {pinFeedback ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'}; background: transparent;"
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
        {#if canEdit && !$isStreaming}
          <!-- Edit & resend (user, text-only) -->
          <button
            type="button"
            class="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-all duration-200"
            style="border-color: var(--ui-border); color: var(--ui-text-secondary); background: transparent;"
            onclick={startEdit}
            title="Edit & resend"
            aria-label="Edit and resend this message"
          >
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
              ><path
                d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"
              ></path></svg
            >
          </button>
        {/if}
        {#if canRegenerate && !$isStreaming}
          <!-- Regenerate (last assistant reply, or retry after an error on a trailing user message) -->
          <button
            type="button"
            class="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-all duration-200"
            style="border-color: var(--ui-border); color: var(--ui-text-secondary); background: transparent;"
            onclick={() => onRegenerate?.(message)}
            title={isAssistant ? "Regenerate response" : "Retry — generate a response"}
            aria-label={isAssistant ? "Regenerate response" : "Retry: generate a response"}
          >
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
              ><polyline points="23 4 23 10 17 10"></polyline><polyline
                points="1 20 1 14 7 14"
              ></polyline><path
                d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
              ></path></svg
            >
            <span>{isAssistant ? "Regenerate" : "Retry"}</span>
          </button>
        {/if}
        {#if onDelete && !$isStreaming}
          <!-- Delete message -->
          <button
            type="button"
            class="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-all duration-200"
            style="border-color: var(--ui-border); color: var(--ui-text-secondary); background: transparent;"
            onclick={() => onDelete?.(message)}
            title="Delete message"
            aria-label="Delete this message"
          >
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
              ><polyline points="3 6 5 6 21 6"></polyline><path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              ></path></svg
            >
          </button>
        {/if}
      </div>
      {#if isAssistant && (message.stats || content)}
        <div class="perf-stats-wrap mt-2 flex justify-start">
          <PerfStats
            stats={message.stats}
            contentLength={content.length}
            elapsedMs={message.stats?.elapsed_ms}
          />
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .message-bubble-inner {
    font-size: 14px;
    line-height: 1.5;
  }
  .thinking-label {
    animation: thinking-label-fade 2s ease-in-out infinite;
  }
  @keyframes thinking-label-fade {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
</style>
