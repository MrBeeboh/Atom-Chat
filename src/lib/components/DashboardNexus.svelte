<script>
  import { onMount } from 'svelte';
  import {
    activeConversationId,
    activeMessages,
    conversations,
    settings,
    effectiveModelId,
    isStreaming,
    chatError,
    selectedModelId,
    models,
    lastResponseTokens,
    lastResponseTokPerSec,
    updateSettings,
  } from '$lib/stores.js';
  import { getMessages, addMessage, clearMessages, getMessageCount, listConversations, updateConversation } from '$lib/db.js';
  import { sendMessage } from '$lib/api/lmstudio.js';
  import { generateId } from '$lib/utils.js';
  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';

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
    const out = msgs
      .map((m) => ({
        role: m.role,
        content:
          typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content.find((p) => p.type === 'text')?.text ?? ''
              : '',
      }))
      .filter((m) => m.content || m.role === 'assistant');
    if (systemPrompt?.trim()) out.unshift({ role: 'system', content: systemPrompt.trim() });
    return out;
  }

  async function sendUserMessage(text) {
    if (!convId || !text.trim()) return;
    chatError.set(null);
    if (!$effectiveModelId) {
      chatError.set('Please select a model from the dropdown above.');
      return;
    }
    const userContent = text.trim();
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
          if (last && last.role === 'assistant')
            out[out.length - 1] = { ...last, content: fullContent, modelId: $effectiveModelId };
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
      await updateConversation(convId, { title });
      const list = await listConversations();
      const withCount = await Promise.all(
        list.map(async (c) => ({ ...c, messageCount: await getMessageCount(c.id) }))
      );
      conversations.set(withCount);
    }
  }

  async function clearChat() {
    if (!convId) return;
    await clearMessages(convId);
    await loadMessages();
  }

  const MAX_TOKENS_MIN = 128;
  const MAX_TOKENS_MAX = 131072;
  function stepMaxTokDown() {
    const next = Math.max(MAX_TOKENS_MIN, Math.round(($settings.max_tokens ?? 4096) / 2));
    updateSettings({ max_tokens: next });
  }
  function stepMaxTokUp() {
    const next = Math.min(MAX_TOKENS_MAX, Math.round(($settings.max_tokens ?? 4096) * 2));
    updateSettings({ max_tokens: next });
  }

  const PROMPT_PRESETS = [
    { category: 'Creative', label: 'Story starter', text: 'Write the opening paragraph of a short story about ' },
    { category: 'Creative', label: 'Poem', text: 'Write a short poem on the theme of ' },
    { category: 'Coding', label: 'Explain code', text: 'Explain what this code does and suggest improvements:\n\n' },
    { category: 'Coding', label: 'Debug', text: 'Help me debug the following. Error message:\n\n' },
    { category: 'Analysis', label: 'Summarize', text: 'Summarize the following in 3 bullet points:\n\n' },
    { category: 'Analysis', label: 'Compare', text: 'Compare and contrast the following two approaches:\n\n' },
  ];
  let copiedLabel = $state(null);
  function copyPreset(preset) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(preset.text);
    copiedLabel = preset.label;
    setTimeout(() => (copiedLabel = null), 2000);
  }

  const lastEightMessages = $derived(($activeMessages || []).slice(-8));
  const tokenEstimates = $derived(
    lastEightMessages.map((m) => {
      const text = typeof m.content === 'string' ? m.content : (m.content?.find?.((p) => p.type === 'text')?.text ?? '');
      return Math.ceil((text?.length ?? 0) / 4);
    })
  );

  const responseTimeSec =
    $lastResponseTokens != null && $lastResponseTokPerSec != null && $lastResponseTokPerSec > 0
      ? ($lastResponseTokens / $lastResponseTokPerSec).toFixed(1)
      : null;
</script>

<div class="nexus-dashboard flex flex-col h-full min-h-0" style="background-color: var(--ui-bg-main);">
  <div class="nexus-grid flex-1 min-h-0 p-4 gap-4 grid grid-cols-1 md:grid-cols-[20%_1fr_30%] grid-rows-[1fr_auto] md:grid-rows-[1fr_1fr]">
    <!-- Top row -->
    <section
      class="nexus-panel rounded-lg border-2 overflow-hidden flex flex-col min-h-0"
      style="border-color: var(--ui-border); background-color: var(--ui-bg-primary);"
      aria-label="Model Status"
    >
      <h3 class="shrink-0 px-3 py-2 text-xs font-medium uppercase tracking-wide border-b" style="border-color: var(--ui-border); color: var(--ui-text-secondary);">
        Model Status
      </h3>
      <div class="p-3 flex flex-col gap-2 overflow-auto">
        <p class="text-sm truncate" style="color: var(--ui-text-primary);" title="{$selectedModelId || 'None'}">
          {$selectedModelId || 'No model'}
        </p>
        <span
          class="inline-flex items-center gap-1 text-xs w-fit"
          style="color: {$isStreaming ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'};"
        >
          <span class="w-2 h-2 rounded-full" style="background: {$isStreaming ? 'var(--ui-accent)' : 'var(--ui-border)'};"></span>
          {$isStreaming ? 'Active' : 'Idle'}
        </span>
        <select
          class="w-full rounded border px-2 py-1.5 text-sm min-w-0"
          style="border-color: var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);"
          bind:value={$selectedModelId}
          aria-label="Quick model switcher"
        >
          <option value="">Select model</option>
          {#each $models as m}
            <option value={m.id}>{m.id}</option>
          {/each}
        </select>
      </div>
    </section>

    <section
      class="nexus-panel nexus-chat rounded-lg border-2 overflow-hidden flex flex-col min-h-0 md:col-span-1"
      style="border-color: var(--ui-border); background-color: var(--ui-bg-primary);"
      aria-label="Chat Panel"
    >
      <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b" style="border-color: var(--ui-border);">
        <span class="text-xs font-medium uppercase tracking-wide" style="color: var(--ui-text-secondary);">Chat</span>
        {#if convId && $activeMessages.length > 0}
          <button
            type="button"
            class="text-xs px-2 py-1 rounded border transition-colors"
            style="border-color: var(--ui-border); color: var(--ui-text-secondary);"
            onclick={clearChat}
            title="Clear all messages"
          >
            Clear
          </button>
        {/if}
      </div>
      {#if convId}
        {#if $activeMessages.length === 0}
          <div class="flex-1 flex items-center justify-center p-4">
            <p class="text-sm" style="color: var(--ui-text-secondary);">Start a conversation below.</p>
          </div>
        {:else}
          <div class="flex-1 overflow-y-auto min-h-0">
            <MessageList />
          </div>
        {/if}
      {:else}
        <div class="flex-1 flex items-center justify-center p-4">
          <p class="text-sm" style="color: var(--ui-text-secondary);">Create or select a conversation from the sidebar.</p>
        </div>
      {/if}
    </section>

    <section
      class="nexus-panel rounded-lg border-2 overflow-hidden flex flex-col min-h-0"
      style="border-color: var(--ui-border); background-color: var(--ui-bg-primary);"
      aria-label="Output Controls"
    >
      <h3 class="shrink-0 px-3 py-2 text-xs font-medium uppercase tracking-wide border-b" style="border-color: var(--ui-border); color: var(--ui-text-secondary);">
        Output Controls
      </h3>
      <div class="p-3 space-y-3 overflow-auto">
        <div>
          <label for="nexus-temp" class="block text-xs font-medium mb-0.5" style="color: var(--ui-text-secondary);">Temperature</label>
          <div class="flex items-center gap-2">
            <input
              id="nexus-temp"
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={$settings.temperature ?? 0.7}
              oninput={(e) => updateSettings({ temperature: parseFloat(e.currentTarget.value) })}
              class="flex-1 h-2 rounded-full accent-themed"
            />
            <span class="text-xs font-mono w-10" style="color: var(--ui-text-primary);">{$settings.temperature ?? 0.7}</span>
          </div>
        </div>
        <div>
          <label for="nexus-top-p" class="block text-xs font-medium mb-0.5" style="color: var(--ui-text-secondary);">Top-P</label>
          <div class="flex items-center gap-2">
            <input
              id="nexus-top-p"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={$settings.top_p ?? 0.95}
              oninput={(e) => updateSettings({ top_p: parseFloat(e.currentTarget.value) })}
              class="flex-1 h-2 rounded-full accent-themed"
            />
            <span class="text-xs font-mono w-10" style="color: var(--ui-text-primary);">{$settings.top_p ?? 0.95}</span>
          </div>
        </div>
        <div>
          <label for="nexus-max-tok" class="block text-xs font-medium mb-0.5" style="color: var(--ui-text-secondary);">Max Tokens</label>
          <div class="flex items-stretch gap-1">
            <input
              id="nexus-max-tok"
              type="number"
              min={MAX_TOKENS_MIN}
              max={MAX_TOKENS_MAX}
              value={$settings.max_tokens ?? 4096}
              oninput={(e) => updateSettings({ max_tokens: Math.max(MAX_TOKENS_MIN, Math.min(MAX_TOKENS_MAX, parseInt(e.currentTarget.value, 10) || MAX_TOKENS_MIN)) })}
              class="flex-1 rounded-l border px-2 py-1 text-sm min-w-0"
              style="border-color: var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);"
            />
            <div class="flex flex-col border rounded-r overflow-hidden" style="border-color: var(--ui-border);">
              <button type="button" class="flex-1 px-1.5 py-0.5 text-xs border-b" style="border-color: var(--ui-border); color: var(--ui-text-secondary);" onclick={stepMaxTokUp} title="Double">▲</button>
              <button type="button" class="flex-1 px-1.5 py-0.5 text-xs" style="color: var(--ui-text-secondary);" onclick={stepMaxTokDown} title="Half">▼</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Bottom row -->
    <section
      class="nexus-panel rounded-lg border-2 overflow-hidden flex flex-col min-h-0 md:col-span-1"
      style="border-color: var(--ui-border); background-color: var(--ui-bg-primary);"
      aria-label="Prompt Builder"
    >
      <h3 class="shrink-0 px-3 py-2 text-xs font-medium uppercase tracking-wide border-b" style="border-color: var(--ui-border); color: var(--ui-text-secondary);">
        Prompt Builder
      </h3>
      <div class="p-3 overflow-auto">
        <select
          class="w-full rounded border px-2 py-1.5 text-sm mb-2"
          style="border-color: var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);"
          aria-label="Preset category"
        >
          <option>Creative</option>
          <option>Coding</option>
          <option>Analysis</option>
        </select>
        <ul class="space-y-1">
          {#each PROMPT_PRESETS as preset}
            <li>
              <button
                type="button"
                class="w-full text-left text-xs px-2 py-1.5 rounded border transition-colors"
                style="border-color: var(--ui-border); color: var(--ui-text-primary);"
                onclick={() => copyPreset(preset)}
              >
                {preset.label}
                {#if copiedLabel === preset.label}
                  <span class="text-green-600 dark:text-green-400 ml-1">Copied</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
        <p class="text-[10px] mt-2" style="color: var(--ui-text-secondary);">Click to copy; paste into input below.</p>
      </div>
    </section>

    <section
      class="nexus-panel rounded-lg border-2 overflow-hidden flex flex-col min-h-0 md:col-span-1"
      style="border-color: var(--ui-border); background-color: var(--ui-bg-primary);"
      aria-label="Visualization"
    >
      <h3 class="shrink-0 px-3 py-2 text-xs font-medium uppercase tracking-wide border-b" style="border-color: var(--ui-border); color: var(--ui-text-secondary);">
        Token usage (last 8 messages)
      </h3>
      <div class="p-3 overflow-auto">
        {#if tokenEstimates.length === 0}
          <p class="text-xs" style="color: var(--ui-text-secondary);">No messages yet.</p>
        {:else}
          <table class="w-full text-xs" style="color: var(--ui-text-primary);">
            <thead>
              <tr style="color: var(--ui-text-secondary);">
                <th class="text-left py-0.5">#</th>
                <th class="text-right py-0.5">Est. tokens</th>
              </tr>
            </thead>
            <tbody>
              {#each tokenEstimates as est, i}
                <tr>
                  <td class="py-0.5">{lastEightMessages.length - tokenEstimates.length + i + 1}</td>
                  <td class="text-right font-mono py-0.5">{est}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </section>

    <section
      class="nexus-panel rounded-lg border-2 overflow-hidden flex flex-col min-h-0 md:col-span-1"
      style="border-color: var(--ui-border); background-color: var(--ui-bg-primary);"
      aria-label="Analytics"
    >
      <h3 class="shrink-0 px-3 py-2 text-xs font-medium uppercase tracking-wide border-b" style="border-color: var(--ui-border); color: var(--ui-text-secondary);">
        Analytics
      </h3>
      <div class="p-3 space-y-1.5 overflow-auto text-sm">
        <p><span style="color: var(--ui-text-secondary);">Tokens used:</span> <span class="font-mono">{$lastResponseTokens ?? '—'}</span></p>
        <p><span style="color: var(--ui-text-secondary);">Tok/s:</span> <span class="font-mono">{$lastResponseTokPerSec != null ? $lastResponseTokPerSec.toFixed(1) : '—'}</span></p>
        <p><span style="color: var(--ui-text-secondary);">Response time:</span> <span class="font-mono">{responseTimeSec != null ? responseTimeSec + 's' : '—'}</span></p>
        <p><span style="color: var(--ui-text-secondary);">Total conversations:</span> <span class="font-mono">{$conversations?.length ?? 0}</span></p>
      </div>
    </section>
  </div>

  <!-- Chat input fixed at bottom -->
  <div
    class="shrink-0 border-t p-4 w-full"
    style="border-color: var(--ui-border); background-color: var(--ui-bg-main);"
  >
    {#if $chatError && $activeMessages.length > 0}
      <div
        class="mb-3 px-3 py-2 rounded-lg flex items-center justify-between gap-2 text-sm"
        style="background-color: color-mix(in srgb, red 15%, var(--ui-bg-primary)); border: 1px solid var(--ui-border); color: var(--ui-text-primary);"
      >
        <span>{$chatError}</span>
        <button type="button" class="shrink-0 p-1 rounded hover:opacity-80" onclick={() => chatError.set(null)} aria-label="Dismiss">×</button>
      </div>
    {/if}
    <div class="max-w-3xl mx-auto">
      <ChatInput onSend={sendUserMessage} />
    </div>
  </div>
</div>

<style>
  .nexus-dashboard {
    --nexus-gap: 16px;
  }
  .nexus-grid {
    gap: var(--nexus-gap);
  }
  @media (max-width: 767px) {
    .nexus-grid {
      grid-template-columns: 1fr;
      grid-template-rows: auto;
    }
    .nexus-panel {
      min-height: 120px;
    }
    .nexus-chat {
      min-height: 200px;
    }
  }
</style>
