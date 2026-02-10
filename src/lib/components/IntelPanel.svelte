<script>
  import {
    settings,
    selectedModelId,
    lastResponseTokPerSec,
    lastResponseTokens,
    activeMessages,
    updateSettings,
    settingsOpen,
    activeConversationId,
    conversations,
  } from '$lib/stores.js';
  import { createConversation, listConversations, getMessageCount } from '$lib/db.js';
  import { getModelIcon, getQuantization, modelIconOverrides } from '$lib/modelIcons.js';

  let responseHistory = $state([]);
  const MAX_HISTORY = 5;
  let lastPushedTps = $state(null);
  let lastPushedTokens = $state(null);

  let tpsVal = $state(null);
  let tokensVal = $state(null);
  $effect(() => {
    const unsubT = lastResponseTokPerSec.subscribe((v) => (tpsVal = v));
    const unsubN = lastResponseTokens.subscribe((v) => (tokensVal = v));
    return () => {
      unsubT();
      unsubN();
    };
  });

  $effect(() => {
    const tps = tpsVal;
    const tokens = tokensVal;
    if (tps != null && tokens != null && Number(tps) > 0 && (tps !== lastPushedTps || tokens !== lastPushedTokens)) {
      lastPushedTps = tps;
      lastPushedTokens = tokens;
      const elapsedMs = Math.round((Number(tokens) / Number(tps)) * 1000);
      responseHistory = [
        { tokens: Number(tokens), tps: Number(tps), elapsedMs },
        ...responseHistory.slice(0, MAX_HISTORY - 1),
      ];
    }
    return () => {};
  });

  let settingsVal = $state({});
  let contextLength = $state(4096);
  let temperature = $state(0.7);
  let topP = $state(0.95);
  let topK = $state(64);
  let currentModelId = $state('');
  let messagesList = $state([]);

  $effect(() => {
    const unsubC = selectedModelId.subscribe((v) => (currentModelId = v ?? ''));
    return () => unsubC();
  });

  $effect(() => {
    const unsub = settings.subscribe((s) => {
      settingsVal = s ?? {};
      contextLength = s?.context_length ?? 4096;
      temperature = s?.temperature ?? 0.7;
      topP = s?.top_p ?? 0.95;
      topK = s?.top_k ?? 64;
    });
    return () => unsub();
  });

  $effect(() => {
    const unsub = activeMessages.subscribe((v) => (messagesList = v ?? []));
    return () => unsub();
  });

  const estimatedContextUsed = $derived(
    messagesList.reduce((acc, m) => {
      const text = typeof m.content === 'string' ? m.content : m.content?.find((p) => p.type === 'text')?.text ?? '';
      return acc + Math.ceil((text?.length ?? 0) / 4);
    }, 0)
  );
  const contextPercent = $derived(
    contextLength > 0 ? Math.min(100, Math.round((estimatedContextUsed / contextLength) * 100)) : 0
  );

  async function resetContext() {
    const id = await createConversation();
    let list = await listConversations();
    list = await Promise.all(list.map(async (c) => ({ ...c, messageCount: await getMessageCount(c.id) })));
    conversations.set(list);
    activeConversationId.set(id);
  }

  function onTempInput(e) {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) updateSettings({ temperature: v });
  }
  function onTopPInput(e) {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) updateSettings({ top_p: v });
  }
  function onTopKInput(e) {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v)) updateSettings({ top_k: v });
  }

  function openSettings() {
    settingsOpen.set(true);
  }
</script>

<div
  class="intel-panel flex flex-col gap-4 overflow-y-auto p-3 text-sm h-full"
  style="color: var(--ui-text-secondary); background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);">
  <div>
    <div class="font-medium mb-1.5 text-xs uppercase tracking-wide flex items-center justify-between gap-2">
      <span style="color: var(--ui-text-primary);">Context</span>
      <button
        type="button"
        class="text-[10px] px-2 py-1 rounded border shrink-0 hover:opacity-90"
        style="border-color: var(--ui-border); color: var(--ui-text-secondary);"
        onclick={resetContext}
        title="Start a new chat to reset context usage">
        Reset context
      </button>
    </div>
    <div class="h-2 rounded-full overflow-hidden border" style="background: var(--ui-input-bg); border-color: var(--ui-border);">
      <div
        class="h-full rounded-full transition-all duration-300"
        style="width: {contextPercent}%; background: var(--ui-accent);"
        role="progressbar"
        aria-valuenow={contextPercent}
        aria-valuemin="0"
        aria-valuemax="100"></div>
    </div>
    <div class="mt-1 font-mono text-[10px] opacity-80">{estimatedContextUsed} / {contextLength} (est.)</div>
  </div>

  <div>
    <div class="font-medium mb-1.5 text-xs uppercase tracking-wide" style="color: var(--ui-text-primary);">Current model</div>
    <div class="rounded-lg border p-2 flex items-center gap-2" style="border-color: var(--ui-border); background: var(--ui-input-bg);">
      {#if currentModelId}
        <img src={getModelIcon(currentModelId, $modelIconOverrides)} alt="" class="w-6 h-6 shrink-0 rounded object-contain" />
        <span class="truncate flex-1 text-xs font-medium min-w-0" style="color: var(--ui-text-primary);">{currentModelId}</span>
        {#if getQuantization(currentModelId)}
          <span class="text-[10px] px-1.5 py-0.5 rounded font-mono opacity-80" style="background: var(--ui-border);">{getQuantization(currentModelId)}</span>
        {/if}
      {:else}
        <span class="text-xs opacity-70">Select model in header</span>
      {/if}
      <button
        type="button"
        class="shrink-0 text-[10px] px-2 py-1 rounded border hover:opacity-90"
        style="border-color: var(--ui-border); color: var(--ui-text-primary);"
        onclick={openSettings}
        title="Open settings">Settings</button>
    </div>
  </div>

  <div>
    <div class="font-medium mb-1.5 text-xs uppercase tracking-wide" style="color: var(--ui-text-primary);">Parameters</div>
    <div class="space-y-3">
      <div>
        <div class="flex justify-between text-[10px] mb-0.5"><span>Temperature</span><span class="font-mono">{temperature}</span></div>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={temperature}
          oninput={onTempInput}
          class="w-full h-1.5 rounded-full"
          style="background: var(--ui-input-bg); accent-color: var(--ui-accent);" />
      </div>
      <div>
        <div class="flex justify-between text-[10px] mb-0.5"><span>Top-P</span><span class="font-mono">{topP}</span></div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={topP}
          oninput={onTopPInput}
          class="w-full h-1.5 rounded-full"
          style="background: var(--ui-input-bg); accent-color: var(--ui-accent);" />
      </div>
      <div>
        <div class="flex justify-between text-[10px] mb-0.5"><span>Top-K</span><span class="font-mono">{topK}</span></div>
        <input
          type="range"
          min="1"
          max="200"
          step="1"
          value={topK}
          oninput={onTopKInput}
          class="w-full h-1.5 rounded-full"
          style="background: var(--ui-input-bg); accent-color: var(--ui-accent);" />
      </div>
    </div>
  </div>

  <div>
    <div class="font-medium mb-1.5 text-xs uppercase tracking-wide" style="color: var(--ui-text-primary);">Response log</div>
    <div class="rounded border overflow-hidden font-mono text-[10px]" style="border-color: var(--ui-border); background: var(--ui-input-bg);">
      {#if responseHistory.length === 0}
        <div class="p-2 opacity-60">No completions yet</div>
      {:else}
        <table class="w-full">
          <thead>
            <tr class="border-b" style="border-color: var(--ui-border);">
              <th class="text-left p-1.5">t/s</th>
              <th class="text-left p-1.5">tokens</th>
              <th class="text-left p-1.5">ms</th>
            </tr>
          </thead>
          <tbody>
            {#each responseHistory as row}
              <tr class="border-b border-zinc-200/50 dark:border-zinc-600/50" style="border-color: var(--ui-border);">
                <td class="p-1.5" style="color: var(--ui-accent);">{row.tps.toFixed(1)}</td>
                <td class="p-1.5">{row.tokens}</td>
                <td class="p-1.5">{row.elapsedMs}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
</div>
