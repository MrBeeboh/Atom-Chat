<script>
  import { get } from 'svelte/store';
  import { activeConversationId, activeMessages, conversations, settings, effectiveModelId, isStreaming, chatError, chatCommand, pendingDroppedFiles, webSearchForNextMessage, webSearchInProgress, webSearchConnected } from '$lib/stores.js';
  import { getMessages, addMessage, clearMessages, deleteMessage, getMessageCount } from '$lib/db.js';
  import { streamChatCompletion } from '$lib/api.js';
  import { searchDuckDuckGo, formatSearchResultForChat } from '$lib/duckduckgo.js';
  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import AtomLogo from '$lib/components/AtomLogo.svelte';
  import { generateId, resizeImageDataUrlsForVision, shouldSkipImageResizeForVision } from '$lib/utils.js';

  const convId = $derived($activeConversationId);
  let chatAbortController = $state(null);

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

  $effect(() => {
    const cmd = $chatCommand;
    if (!cmd?.type || !convId) return;
    if (cmd.type === 'clear') {
      clearChat();
    } else if (cmd.type === 'export') {
      exportChat();
    }
    chatCommand.set(null);
  });

  async function exportChat() {
    if (!convId) return;
    const msgs = await getMessages(convId);
    const lines = msgs.map((m) => `**${m.role}:**\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n---\n\n');
    const blob = new Blob([lines], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${convId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

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

    let effectiveText = (text || '').trim();
    if (get(webSearchForNextMessage) && hasText) {
      webSearchForNextMessage.set(false);
      webSearchInProgress.set(true);
      try {
        const searchResult = await searchDuckDuckGo(effectiveText);
        webSearchConnected.set(true);
        const formatted = formatSearchResultForChat(effectiveText, searchResult);
        effectiveText = formatted + '\n\n---\nUser question: ' + effectiveText;
      } catch (e) {
        webSearchConnected.set(false);
        chatError.set(e?.message || 'Web search failed. Try again or send without internet.');
        webSearchInProgress.set(false);
        return;
      }
      webSearchInProgress.set(false);
    }

    // Vision: skip resize for Qwen-VL 4B/8B; otherwise resize when payload > 1 MB
    const skipResize = shouldSkipImageResizeForVision($effectiveModelId);
    const urlsForApi = hasImages
      ? (skipResize ? imageDataUrls : await resizeImageDataUrlsForVision(imageDataUrls))
      : [];
    const userContent = hasImages
      ? [
          ...(effectiveText ? [{ type: 'text', text: effectiveText }] : [{ type: 'text', text: ' ' }]),
          ...urlsForApi.map((url) => ({
            type: 'image_url',
            image_url: { url, ...(skipResize ? {} : { detail: 'low' }) },
          })),
        ]
      : effectiveText;

    // Build payload from history + this message so the latest user message is always included
    // (avoids any race where a post-write DB read might not yet see the new message)
    const history = await getMessages(convId);
    await addMessage(convId, { role: 'user', content: userContent });
    await loadMessages();
    const msgsForApi = [...history, { role: 'user', content: userContent }];
    const apiMessages = buildApiMessages(msgsForApi, $settings.system_prompt);

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
    const controller = new AbortController();
    chatAbortController = controller;

    let streamResult;
    try {
      streamResult = await streamChatCompletion({
        model: $effectiveModelId,
        messages: apiMessages,
        options: {
          temperature: $settings.temperature,
          max_tokens: $settings.max_tokens,
          top_p: $settings.top_p,
          top_k: $settings.top_k,
          repeat_penalty: $settings.repeat_penalty,
          stop: $settings.stop?.length ? $settings.stop : undefined,
          ttl: $settings.model_ttl_seconds,
        },
        signal: controller.signal,
        onChunk(chunk) {
          fullContent += chunk;
          activeMessages.update((arr) => {
            const out = [...arr];
            const last = out[out.length - 1];
            if (last && last.role === 'assistant') out[out.length - 1] = { ...last, content: fullContent, modelId: $effectiveModelId };
            return out;
          });
        },
        onDone() {
          chatAbortController = null;
        },
      });
    } catch (err) {
      const raw = err?.message || '';
      const isLoadError = raw.includes('Failed to load model') || raw.includes('Error loading model');
      const friendly = isLoadError
        ? 'Model failed to load in LM Studio. Load the model in LM Studio first (or check memory). If it still fails, try re-downloading the model in case the file is corrupted.'
        : raw || 'Failed to get response. Is your model server running and the model loaded?';
      chatError.set(friendly);
      activeMessages.update((arr) => arr.filter((m) => m.id !== assistantMsgId));
      return;
    } finally {
      chatAbortController = null;
      isStreaming.set(false);
    }

    if (streamResult?.aborted) return;

    const completionTokens = streamResult?.usage?.completion_tokens ?? Math.max(1, Math.ceil(fullContent.length / 4));
    const elapsedMs = streamResult?.elapsedMs ?? 0;
    const stats =
      elapsedMs > 0
        ? {
            completion_tokens: completionTokens,
            elapsed_ms: elapsedMs,
            prompt_tokens: streamResult?.usage?.prompt_tokens ?? undefined,
            estimated: streamResult?.usage?.completion_tokens == null,
          }
        : null;
    await addMessage(convId, { role: 'assistant', content: fullContent, modelId: $effectiveModelId, stats });
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
      <!-- Greeting: ATOM branding, headline, gradient divider, input (power-user tone) -->
      <div class="ui-splash-wrap flex-1 flex flex-col items-center justify-center px-4 py-8 min-h-0">
        <div class="w-full max-w-[min(700px,92%)] mx-auto flex flex-col items-center">
          <div class="ui-splash-branding flex items-center justify-center gap-2 mb-2" aria-hidden="true"><AtomLogo size={32} /><span>ATOM</span></div>
          <h1 class="ui-greeting-title text-2xl md:text-3xl font-semibold mb-8 text-center" style="color: var(--ui-text-primary);">What can I help with?</h1>
          {#if $chatError}
            <div class="mb-4 w-full px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center justify-between gap-2">
              <span>{$chatError}</span>
              <button type="button" class="shrink-0 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30" onclick={() => chatError.set(null)} aria-label="Dismiss">×</button>
            </div>
          {/if}
          <div class="ui-splash-divider mb-6 w-full max-w-[min(700px,92%)]" aria-hidden="true"></div>
          <div class="w-full min-w-0">
            <ChatInput
              onSend={sendUserMessage}
              onStop={() => chatAbortController?.abort?.()}
              placeholder="Ask anything. Type or paste here... (Ctrl+Enter to send)"
            />
          </div>
        </div>
      </div>
    {:else}
      <!-- After first message: messages above, input fixed at bottom -->
      <div class="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-zinc-200/60 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/30">
        <div class="max-w-[min(960px,92%)] mx-auto w-full flex flex-wrap items-center gap-2">
          <button type="button" class="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors" onclick={clearChat} title="Clear all messages">Clear</button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto">
        <MessageList />
      </div>
      <div class="shrink-0 border-t border-zinc-200/60 dark:border-zinc-800/80 p-4" style="background-color: var(--ui-bg-main);">
        <div class="max-w-[min(960px,92%)] mx-auto w-full">
          {#if $chatError}
            <div class="mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center justify-between gap-2">
              <span>{$chatError}</span>
              <button type="button" class="shrink-0 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30" onclick={() => chatError.set(null)} aria-label="Dismiss">×</button>
            </div>
          {/if}
          <ChatInput onSend={sendUserMessage} onStop={() => chatAbortController?.abort?.()} />
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
