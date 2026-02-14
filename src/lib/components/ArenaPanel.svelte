<script>
  /**
   * ArenaPanel: Reusable response panel for Arena slots A–D.
   * Shows: header (label), options accordion, scrollable message area, footer (score + standing + t/s + clear).
   */
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { arenaSlotOverrides, setArenaSlotOverride } from '$lib/stores.js';
  import { ARENA_SYSTEM_PROMPT_TEMPLATES } from '$lib/arenaLogic.js';
  import MessageBubble from '$lib/components/MessageBubble.svelte';

  let {
    slot = 'A',
    modelId = '',
    messages = [],
    running = false,
    slotError = '',
    tps = null,
    score = 0,
    standingLabel = '—',
    effectiveSettings = {},
    optionsOpen = false,
    /** @type {(e?: MouseEvent) => void} */
    onToggleOptions = (e) => {},
    /** @type {(e?: MouseEvent) => void} */
    onClear = (e) => {},
    scrollRef = $bindable(null),
    /** Per-slot accent color */
    accentColor = 'var(--ui-accent)',
    /** Show score + standing in footer */
    showScore = true,
    /** Model load status: null | 'loading' | 'loaded' | 'error' */
    loadStatus = null,
    /** When set, hide the user message that matches this (question is shown once in header) */
    currentQuestionText = '',
    /** When set, filter by question id instead of string match (preferred for reproducibility). */
    currentQuestionId = null,
  } = $props();

  const displayMessages = $derived(
    currentQuestionId != null
      ? messages.filter(
          (m) => m.role !== 'user' || m.questionId !== currentQuestionId
        )
      : currentQuestionText
        ? messages.filter(
            (m) =>
              m.role !== 'user' ||
              (typeof m.content === 'string' ? m.content : '') !== currentQuestionText
          )
        : messages
  );

  function slotOverrideInput(key) {
    return (e) => {
      const el = e.currentTarget;
      if (!el || typeof el.value === 'undefined') return;
      const raw = el.value;
      const cur = $arenaSlotOverrides[slot] ?? {};
      if (key === 'temperature') {
        const v = raw === '' ? undefined : parseFloat(raw);
        const safe = v !== undefined && !Number.isNaN(v) && v >= 0 && v <= 2 ? v : cur.temperature;
        setArenaSlotOverride(slot, { ...cur, temperature: safe });
      } else if (key === 'max_tokens') {
        const v = raw === '' ? undefined : parseInt(raw, 10);
        const safe = v !== undefined && !Number.isNaN(v) && v >= 1 ? Math.min(100000, v) : cur.max_tokens;
        setArenaSlotOverride(slot, { ...cur, max_tokens: safe });
      } else if (key === 'system_prompt') {
        setArenaSlotOverride(slot, { ...cur, system_prompt: typeof raw === 'string' ? raw.trim() || undefined : undefined });
      } else if (key === 'top_p') {
        const v = raw === '' ? undefined : parseFloat(raw);
        const safe = v !== undefined && !Number.isNaN(v) && v >= 0 && v <= 1 ? v : cur.top_p;
        setArenaSlotOverride(slot, { ...cur, top_p: safe });
      } else if (key === 'top_k') {
        const v = raw === '' ? undefined : parseInt(raw, 10);
        const safe = v !== undefined && !Number.isNaN(v) && v >= 1 ? Math.min(200, v) : cur.top_k;
        setArenaSlotOverride(slot, { ...cur, top_k: safe });
      } else if (key === 'repeat_penalty') {
        const v = raw === '' ? undefined : parseFloat(raw);
        const safe = v !== undefined && !Number.isNaN(v) && v >= 1 && v <= 2 ? v : cur.repeat_penalty;
        setArenaSlotOverride(slot, { ...cur, repeat_penalty: safe });
      } else if (key === 'presence_penalty') {
        const v = raw === '' ? undefined : parseFloat(raw);
        const safe = v !== undefined && !Number.isNaN(v) && v >= -2 && v <= 2 ? v : cur.presence_penalty;
        setArenaSlotOverride(slot, { ...cur, presence_penalty: safe });
      } else if (key === 'frequency_penalty') {
        const v = raw === '' ? undefined : parseFloat(raw);
        const safe = v !== undefined && !Number.isNaN(v) && v >= -2 && v <= 2 ? v : cur.frequency_penalty;
        setArenaSlotOverride(slot, { ...cur, frequency_penalty: safe });
      }
    };
  }

  function applyTemplate(templatePrompt) {
    if (!templatePrompt) return;
    setArenaSlotOverride(slot, { ...($arenaSlotOverrides[slot] ?? {}), system_prompt: templatePrompt });
  }
</script>

<div
  class="flex flex-col min-h-0 h-full overflow-hidden rounded-lg atom-panel-wrap border"
  style="background-color: var(--ui-bg-main); border-color: var(--ui-border);"
  role="region"
  aria-label="Model {slot} panel"
  in:fly={{ x: 200, duration: 800, easing: quintOut }}
>
  <!-- Header -->
  <div class="shrink-0 flex items-center justify-between gap-2 px-2 py-1.5 border-b text-[11px]" style="color: var(--ui-text-secondary); border-color: var(--ui-border);">
    <div class="flex items-center gap-2">
      <span class="font-medium">{slot}</span>
      {#if loadStatus === 'loading'}
        <span class="text-[10px] animate-pulse" style="color: var(--ui-accent);">loading…</span>
      {:else if loadStatus === 'loaded'}
        <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: #22c55e;" title="Model loaded"></span>
      {:else if loadStatus === 'error'}
        <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: #ef4444;" title="Load error"></span>
      {/if}
    </div>
  </div>

  <!-- Error -->
  {#if slotError}
    <div class="shrink-0 px-2 py-0.5 text-[10px]" style="color: var(--ui-accent-hot);">{slotError}</div>
  {/if}

  <!-- Options accordion -->
  {#if optionsOpen}
    <div class="shrink-0 p-2 border-b text-xs" style="border-color: var(--ui-border); background-color: var(--ui-input-bg);">
      <p class="font-medium mb-1.5" style="color: var(--ui-text-secondary);">Model {slot} settings</p>
      <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center">
        <label class="text-zinc-500 dark:text-zinc-400">Temperature</label>
        <input type="number" step="0.1" min="0" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.temperature ?? effectiveSettings.temperature} oninput={slotOverrideInput('temperature')} />
        <label class="text-zinc-500 dark:text-zinc-400">Max tokens</label>
        <input type="number" min="1" max="100000" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.max_tokens ?? effectiveSettings.max_tokens} oninput={slotOverrideInput('max_tokens')} />
        <label class="text-zinc-500 dark:text-zinc-400">Top-P</label>
        <input type="number" step="0.05" min="0" max="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.top_p ?? effectiveSettings.top_p} oninput={slotOverrideInput('top_p')} />
        <label class="text-zinc-500 dark:text-zinc-400">Top-K</label>
        <input type="number" min="1" max="200" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.top_k ?? effectiveSettings.top_k} oninput={slotOverrideInput('top_k')} />
        <label class="text-zinc-500 dark:text-zinc-400">Repeat penalty</label>
        <input type="number" step="0.05" min="1" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.repeat_penalty ?? effectiveSettings.repeat_penalty} oninput={slotOverrideInput('repeat_penalty')} />
        <label class="text-zinc-500 dark:text-zinc-400">Presence penalty</label>
        <input type="number" step="0.1" min="-2" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.presence_penalty ?? effectiveSettings.presence_penalty} oninput={slotOverrideInput('presence_penalty')} />
        <label class="text-zinc-500 dark:text-zinc-400">Frequency penalty</label>
        <input type="number" step="0.1" min="-2" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.frequency_penalty ?? effectiveSettings.frequency_penalty} oninput={slotOverrideInput('frequency_penalty')} />
      </div>
      <label class="block mt-1.5 text-zinc-500 dark:text-zinc-400">System prompt template</label>
      <select class="w-full mb-0.5 px-1.5 py-0.5 rounded border text-xs" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" onchange={(e) => { const opt = ARENA_SYSTEM_PROMPT_TEMPLATES.find((t) => t.name === e.currentTarget?.value); if (opt?.prompt) applyTemplate(opt.prompt); }} aria-label="System prompt template">
        {#each ARENA_SYSTEM_PROMPT_TEMPLATES as t}<option value={t.name}>{t.name}</option>{/each}
      </select>
      <label class="block mt-1 text-zinc-500 dark:text-zinc-400">System prompt (optional)</label>
      <textarea rows="2" class="w-full mt-0.5 px-1.5 py-1 rounded border text-xs resize-y" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" placeholder="Leave blank to use Arena default" value={$arenaSlotOverrides[slot]?.system_prompt ?? ''} oninput={slotOverrideInput('system_prompt')}></textarea>
      <button type="button" class="mt-1.5 text-[10px] underline opacity-80 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => setArenaSlotOverride(slot, null)}>Reset to Arena default</button>
    </div>
  {/if}

  <!-- Messages -->
  <div class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 overscroll-contain" bind:this={scrollRef}>
    {#if !modelId}
      <div class="text-sm" style="color: var(--ui-text-secondary);">Select a model to start.</div>
    {:else if displayMessages.length === 0}
      <div class="text-sm" style="color: var(--ui-text-secondary);">No responses yet.</div>
    {:else}
      <div class="space-y-5 py-1">
        {#each displayMessages as msg (msg.id)}
          <MessageBubble message={msg} />
        {/each}
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="shrink-0 flex justify-between items-center gap-2 px-2.5 py-2 border-t text-[11px]" style="border-color: var(--ui-border);">
    {#if showScore}
      <div class="flex items-center gap-2 min-w-0">
        <span class="arena-panel-score font-bold tabular-nums shrink-0 px-2 py-0.5 rounded text-xs" style="color: {accentColor}; background: color-mix(in srgb, {accentColor} 14%, transparent);">{score} pts</span>
        <span class="text-[10px] font-medium uppercase tracking-wide opacity-90" style="color: var(--ui-text-secondary);">{standingLabel}</span>
      </div>
    {:else}
      <div></div>
    {/if}
    <div class="flex items-center gap-1">
      <button type="button" class="arena-panel-options-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-opacity hover:opacity-90" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);" onclick={onToggleOptions} aria-label="Model {slot} options" aria-expanded={optionsOpen} title="Model {slot} options">⚙ <span>Options</span></button>
      {#if running}<span style="color: var(--ui-accent);">Running…</span>{:else if tps}{@const c = Number(tps) >= 40 ? 'var(--atom-teal)' : Number(tps) >= 20 ? 'var(--atom-amber)' : 'var(--atom-accent)'}<span class="font-mono px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, {c} 20%, transparent); color: {c};">{tps} t/s</span>{/if}
      {#if messages.length > 0}<button type="button" class="p-0.5 rounded opacity-50 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={onClear} aria-label="Clear slot {slot}">✕</button>{/if}
    </div>
  </div>
</div>
