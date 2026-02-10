<script>
  import { onMount } from 'svelte';
  import { activeConversationId, activeMessages, conversations, settings, effectiveModelId, isStreaming, chatError, pendingDroppedFiles } from '$lib/stores.js';
  import { getMessages, addMessage, clearMessages, deleteMessage, getMessageCount } from '$lib/db.js';
  import { sendMessage } from '$lib/api/lmstudio.js';
  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import { generateId } from '$lib/utils.js';

  const convId = $derived($activeConversationId);

  async function loadMessages(id = convId) {
    if (!id) {
      activeMessages.set([]);
      return;
    }
    const msgs = await getMessages(id);
    activeMessages.set(msgs);
  }

  $effect(() => {
    loadMessages(convId);
  });

  function buildApiMessages(msgs, systemPrompt) {
    const out = msgs.map((m) => ({ role: m.role, content: m.content })).filter((m) => {
      if (m.role === 'system') return true;
      if (typeof m.content === 'string') return m.content.trim().length > 0;
      if (Array.isArray(m.content)) return m.content.length > 0;
      return false;
    });
    if (systemPrompt?.trim()) out.unshift({ role: 'system', content: systemPrompt.trim() });
    return out;
  }

  async function sendUserMessage(text, imageDataUrls = []) {
    const hasText = (text || '').trim().length > 0;
    const hasImages = imageDataUrls?.length > 0;
    if (!convId || (!hasText && !hasImages)) return;
    chatError.set(null);
    if (!$effectiveModelId) {
      chatError.set('Please select a model from the dropdown above.');
      return;
    }

    const userContent = hasImages
      ? [
          ...(hasText ? [{ type: 'text', text: text.trim() }] : [{ type: 'text', text: ' ' }]),
          ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ]
      : text.trim();
    await addMessage(convId, { role: 'user', content: userContent });
    await loadMessages();

    const msgs = await getMessages(convId);
    const apiMessages = buildApiMessages(msgs, $settings.system_prompt);

    const assistantMsgId = generateId();
    const assistantPlaceholder = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      stats: null,
      modelId: $effectiveModelId,
      createdAt: Date.now(),
    };
    activeMessages.update((arr) => [...arr, assistantPlaceholder]);

    isStreaming.set(true);
    let fullContent = '';

    try {
      await sendMessage($effectiveModelId, apiMessages, (chunk) => {
        fullContent += chunk;
        activeMessages.update((arr) => {
          const out = [...arr];
          const last = out[out.length - 1];
          if (last && last.role === 'assistant') out[out.length - 1] = { ...last, content: fullContent, modelId: $effectiveModelId };
          return out;
        });
      });
    } catch (err) {
      chatError.set(err?.message || 'Failed to get response. Is your model server running and the model loaded?');
      activeMessages.update((arr) => arr.filter((m) => m.id !== assistantMsgId));
      return;
    } finally {
      isStreaming.set(false);
    }

    await addMessage(convId, { role: 'assistant', content: fullContent, modelId: $effectiveModelId });
    await loadMessages();

    const conv = $conversations.find((c) => c.id === convId);
    if (conv && conv.title === 'New chat' && fullContent) {
      const title = fullContent.slice(0, 50).replace(/\n/g, ' ').trim() || 'Chat';
      const { updateConversation } = await import('$lib/db.js');
      await updateConversation(convId, { title });
      const { listConversations } = await import('$lib/db.js');
      const list = await listConversations();
      const withCount = await Promise.all(list.map(async (c) => ({ ...c, messageCount: await getMessageCount(c.id) })));
      conversations.set(withCount);
    }
  }

  async function clearChat() {
    if (!convId) return;
    await clearMessages(convId);
    await loadMessages();
  }
</script>

<div
  class="flex-1 flex flex-col min-h-0 chat-drop-zone"
  role="application"
  ondragover={(e) => { e.preventDefault(); e.stopPropagation(); }}
  ondrop={(e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (files?.length) pendingDroppedFiles.set(files);
  }}
>
  {#if convId}
    {#if $activeMessages.length === 0}
      <!-- Perplexity-style: centered start-chat with input in the middle, generous width so placeholder fits -->
      <div class="flex-1 flex flex-col items-center justify-center px-4 py-8 min-h-0">
        <div class="w-full max-w-[min(700px,92%)] mx-auto flex flex-col items-center">
          <h1 class="text-2xl md:text-3xl font-semibold mb-6 text-center" style="color: var(--ui-text-primary);">What can I help with?</h1>
          <div class="flex flex-wrap justify-center gap-2 mb-6">
            {#each ['Explain this concept simply', 'Write a short story', 'Help me debug code', 'Summarize in 3 bullet points'] as suggestion}
              <button
                type="button"
                class="px-4 py-2 rounded-lg text-sm border transition-colors hover:opacity-90 min-h-[44px]"
                style="border-color: var(--ui-border); color: var(--ui-text-secondary); background: var(--ui-input-bg);"
                onclick={() => sendUserMessage(suggestion)}
              >{suggestion}</button>
            {/each}
          </div>
          {#if $chatError}
            <div class="mb-4 w-full px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center justify-between gap-2">
              <span>{$chatError}</span>
              <button type="button" class="shrink-0 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30" onclick={() => chatError.set(null)} aria-label="Dismiss">×</button>
            </div>
          {/if}
          <div class="w-full min-w-0">
            <ChatInput
              onSend={sendUserMessage}
              onStop={() => {}}
              placeholder="Ask anything. Type or paste here... (Ctrl+Enter to send)"
            />
          </div>
        </div>
      </div>
    {:else}
      <!-- After first message: messages above, input fixed at bottom -->
      <div class="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-zinc-200/60 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/30">
        <div class="max-w-3xl mx-auto w-full flex flex-wrap items-center gap-2">
          <button type="button" class="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors" onclick={clearChat} title="Clear all messages">Clear</button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto">
        <MessageList />
      </div>
      <div class="shrink-0 border-t border-zinc-200/60 dark:border-zinc-800/80 p-4" style="background-color: var(--ui-bg-main);">
        <div class="max-w-3xl mx-auto">
          {#if $chatError}
            <div class="mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center justify-between gap-2">
              <span>{$chatError}</span>
              <button type="button" class="shrink-0 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30" onclick={() => chatError.set(null)} aria-label="Dismiss">×</button>
            </div>
          {/if}
          <ChatInput onSend={sendUserMessage} onStop={() => {}} />
        </div>
      </div>
    {/if}
  {:else}
    <div class="flex-1 flex items-center justify-center p-8">
      <div class="text-center max-w-sm">
        <p class="text-xl font-semibold text-zinc-800 dark:text-zinc-200">Start a conversation</p>
        <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-2">Create a new chat from the sidebar or select an existing one.</p>
      </div>
    </div>
  {/if}
</div>
