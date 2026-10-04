<script>
  /**
   * ArenaPanel: Reusable response panel for Arena slots A–D.
   * Shows: header (slot badge + model selector + score + t/s), options accordion, scrollable message area, footer (clear).
   */
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { arenaSlotOverrides, setArenaSlotOverride } from '$lib/stores.js';
  import { ARENA_SYSTEM_PROMPT_TEMPLATES, contentToText, extractContestSvg, extractOpenScadSource, readArenaColumnVisible, writeArenaColumnVisible } from '$lib/arenaLogic.js';
  import ArenaOpenScadPreview from '$lib/components/ArenaOpenScadPreview.svelte';
  import {
    modelPricingCatalog,
    lookupPricing,
    sumAssistantUsage,
    runningCostUsd,
    formatRunningUsd,
    formatTokenCount,
    formatArenaUsageFooter,
  } from '$lib/modelPricing.js';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import ModelSelectorSlot from '$lib/components/ModelSelectorSlot.svelte';
  import ThinkingControls from '$lib/components/ThinkingControls.svelte';

  let {
    slot = 'A',
    modelId = '',
    messages = [],
    running = false,
    slotError = '',
    tps = null,
    liveTps = null,
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
    /** When on, render a contestant SVG if the answer contains one. */
    svgMode = false,
    /** Anonymous round: hide the model name only. Question and answer stay visible. */
    concealIdentity = false,
    /** Parent keeps the scroll-to-bottom ref. Null while the column is hidden. */
    onScrollRef = () => {},
  } = $props();

  const usageTotals = $derived.by(() => {
    const usage = sumAssistantUsage(messages);
    const price = lookupPricing(modelId, $modelPricingCatalog);
    const cost = runningCostUsd(usage.prompt, usage.completion, price, usage.cached);
    return { ...usage, cost, priceKnown: cost != null };
  });

  const usageLabel = $derived.by(() => {
    if (!modelId) return '';
    return formatArenaUsageFooter(usageTotals);
  });

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
      } else if (key === 'thinking' || key === 'thinking_speed') {
        setArenaSlotOverride(slot, { ...cur, [key]: raw || undefined });
      }
    };
  }

  function applyTemplate(templatePrompt) {
    if (!templatePrompt) return;
    setArenaSlotOverride(slot, { ...($arenaSlotOverrides[slot] ?? {}), system_prompt: templatePrompt });
  }

  /** Personal noise filter. Persisted. Default on. Does not change scores or column width. */
  let contentVisible = $state(readArenaColumnVisible(slot));
  $effect(() => {
    onScrollRef(scrollRef);
  });
  function toggleColumnVisible(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    contentVisible = !contentVisible;
    writeArenaColumnVisible(slot, contentVisible);
  }
</script>

<div
  class="arena-col arena-column flex flex-col min-h-0 min-w-0 w-full h-full overflow-hidden rounded-xl atom-panel-wrap arena-col-{slot}"
  style="background: var(--ui-bg-sidebar);"
  role="region"
  aria-label={contentVisible ? `Model ${slot} panel` : `Column ${slot} hidden`}
  in:fly={{ x: 200, duration: 800, easing: quintOut }}
>
  <!-- Header: slot badge + model selector + score + t/s -->
  <div class="arena-col-head shrink-0 flex items-center gap-2 px-3 py-2" style="border-bottom: 1px solid var(--arena-line, #5c6d82);">
    <!-- Slot badge -->
    <span class="arena-slot-badge arena-ink text-[11px] w-5 h-5 rounded flex items-center justify-center shrink-0">{slot}</span>
    <button
      type="button"
      class="arena-visibility-btn shrink-0"
      aria-pressed={contentVisible}
      aria-label={contentVisible ? `Hide column ${slot}` : `Show column ${slot}`}
      title={contentVisible ? `Hide column ${slot}` : `Show column ${slot}`}
      onclick={toggleColumnVisible}
    >
      {#if contentVisible}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-4.4"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.2 4.2"/><path d="M6.1 6.1C3.5 8 2 12 2 12s3.5 7 10 7a10.7 10.7 0 0 0 4.1-.8"/></svg>
      {/if}
    </button>
    {#if contentVisible}
    {#if loadStatus === 'loading'}
      <span class="arena-ink text-[10px] font-bold animate-pulse shrink-0">loading…</span>
    {:else if loadStatus === 'loaded'}
      <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: #22c55e;" title="Model loaded"></span>
    {:else if loadStatus === 'error'}
      <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: #ef4444;" title="Load error"></span>
    {/if}
    <!-- Model selector fills remaining space. Hidden while an anonymous round is concealed. -->
    {#if concealIdentity}
      <span class="flex-1 min-w-0 text-xs font-bold" style="color: var(--arena-read, #12161c);">Hidden</span>
    {:else}
      <div class="flex-1 min-w-0">
        <ModelSelectorSlot slot={slot} />
      </div>
    {/if}
    {/if}
  </div>

  {#if contentVisible}
  <!-- Error -->
  {#if slotError}
    <div class="shrink-0 px-2 py-0.5 text-[10px]" style="color: var(--ui-accent-hot);">{slotError}</div>
  {/if}

  <!-- Options accordion -->
  {#if optionsOpen}
    <div class="arena-slot-options p-3 text-xs" style="background: color-mix(in srgb, var(--ui-border) 10%, var(--ui-bg-main));">
      <p class="font-medium mb-1.5" style="color: var(--ui-text-secondary);">Model {slot} settings</p>
      <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center">
        <label style="color: var(--ui-text-secondary);">Temperature</label>
        <input type="number" step="0.1" min="0" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.temperature ?? effectiveSettings.temperature} oninput={slotOverrideInput('temperature')} />
        <label style="color: var(--ui-text-secondary);">Max tokens</label>
        <input type="number" min="1" max="100000" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.max_tokens ?? effectiveSettings.max_tokens} oninput={slotOverrideInput('max_tokens')} />
        <label style="color: var(--ui-text-secondary);">Top-P</label>
        <input type="number" step="0.05" min="0" max="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.top_p ?? effectiveSettings.top_p} oninput={slotOverrideInput('top_p')} />
        <label style="color: var(--ui-text-secondary);">Top-K</label>
        <input type="number" min="1" max="200" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.top_k ?? effectiveSettings.top_k} oninput={slotOverrideInput('top_k')} />
        <label style="color: var(--ui-text-secondary);">Repeat penalty</label>
        <input type="number" step="0.05" min="1" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.repeat_penalty ?? effectiveSettings.repeat_penalty} oninput={slotOverrideInput('repeat_penalty')} />
        <label style="color: var(--ui-text-secondary);">Presence penalty</label>
        <input type="number" step="0.1" min="-2" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.presence_penalty ?? effectiveSettings.presence_penalty} oninput={slotOverrideInput('presence_penalty')} />
        <label style="color: var(--ui-text-secondary);">Frequency penalty</label>
        <input type="number" step="0.1" min="-2" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides[slot]?.frequency_penalty ?? effectiveSettings.frequency_penalty} oninput={slotOverrideInput('frequency_penalty')} />
      </div>
      <div class="mt-2">
        <ThinkingControls
          modelId={modelId}
          thinking={$arenaSlotOverrides[slot]?.thinking ?? effectiveSettings.thinking}
          speed={$arenaSlotOverrides[slot]?.thinking_speed ?? effectiveSettings.thinking_speed}
          onChange={(patch) => {
            const cur = $arenaSlotOverrides[slot] ?? {};
            setArenaSlotOverride(slot, { ...cur, ...patch });
          }}
        />
      </div>
      <label class="block mt-1.5" style="color: var(--ui-text-secondary);">System prompt template</label>
      <select class="w-full mb-0.5 px-1.5 py-0.5 rounded border text-xs" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" onchange={(e) => { const opt = ARENA_SYSTEM_PROMPT_TEMPLATES.find((t) => t.name === e.currentTarget?.value); if (opt?.prompt) applyTemplate(opt.prompt); }} aria-label="System prompt template">
        {#each ARENA_SYSTEM_PROMPT_TEMPLATES as t}<option value={t.name}>{t.name}</option>{/each}
      </select>
      <label class="block mt-1" style="color: var(--ui-text-secondary);">System prompt (optional)</label>
      <textarea rows="2" class="w-full mt-0.5 px-1.5 py-1 rounded border text-xs resize-y" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" placeholder="Leave blank to use Arena default" value={$arenaSlotOverrides[slot]?.system_prompt ?? ''} oninput={slotOverrideInput('system_prompt')} aria-label="System prompt for slot {slot}"></textarea>
      <button type="button" class="mt-1.5 text-[10px] underline opacity-80 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => setArenaSlotOverride(slot, null)}>Reset to Arena default</button>
    </div>
  {/if}

  <!-- Messages -->
  <div class="arena-column-body flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 overscroll-contain" bind:this={scrollRef}>
    {#if !modelId}
      <div class="text-sm" style="color: var(--ui-text-secondary);">Select a model to start.</div>
    {:else if displayMessages.length === 0}
      <div class="text-sm" style="color: var(--ui-text-secondary);">{running ? 'Working…' : 'No responses yet.'}</div>
    {:else}
      <div class="space-y-5 py-1 min-w-0">
        {#each displayMessages as msg (msg.id)}
          {@const scad = msg.role === 'assistant' && !(running && !msg.stats) ? extractOpenScadSource(contentToText(msg.content)) : null}
          {#if scad}
            <ArenaOpenScadPreview source={scad} />
            <details class="arena-svg-code">
              <summary>code</summary>
              <pre>{contentToText(msg.content)}</pre>
            </details>
          {:else if svgMode && msg.role === 'assistant'}
            {@const svg = extractContestSvg(contentToText(msg.content))}
            {#if svg}
              <div class="arena-svg-frame">{@html svg}</div>
              <details class="arena-svg-code">
                <summary>code</summary>
                <pre>{contentToText(msg.content)}</pre>
              </details>
            {:else}
              <MessageBubble message={msg} hideModelName={concealIdentity} />
              {#if contentToText(msg.content).trim()}
                <p class="arena-no-picture">no picture</p>
              {/if}
            {/if}
          {:else}
            <MessageBubble message={msg} hideModelName={concealIdentity} />
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Footer: actions above the stats so Options never covers totals, tokens, cost, or Clear -->
  <div class="arena-footer shrink-0 px-3 py-1.5" style="border-top: 1px solid var(--ui-border); background: color-mix(in srgb, var(--ui-border) 6%, var(--ui-bg-main));">
    <div class="arena-footer-actions">
      <button type="button" class="arena-panel-options-btn" onclick={onToggleOptions} aria-label="Model {slot} options" aria-expanded={optionsOpen} title="Model {slot} options">⚙ Options</button>
      {#if messages.length > 0}<button type="button" class="arena-footer-clear" onclick={onClear} aria-label="Clear slot {slot}">✕ Clear</button>{/if}
    </div>
    <div class="arena-footer-stats">
    {#if showScore}
      <div class="arena-place" title="Contest total and place. The number is the sum of judge scores so far.">
        <span class="arena-place-n">{score}</span>
        <span class="arena-place-meta">
          <span class="arena-place-k">total</span>
          {#if standingLabel !== '—'}
            <span class="arena-place-rank">{standingLabel}</span>
          {/if}
        </span>
      </div>
    {/if}
    <div class="flex items-center gap-1.5 shrink-0">
      {#if running}
        <span class="arena-ink text-xs font-bold animate-pulse">Running…</span>
        {#if liveTps != null && Number(liveTps) > 0}
          <span class="arena-ink font-mono text-sm font-extrabold" title="Live tokens per second">{Number(liveTps).toFixed(1)} <span class="text-xs font-bold">t/s</span></span>
        {/if}
      {:else if tps}
        <span class="arena-ink font-mono text-sm font-extrabold" title="Tokens per second">{tps} <span class="text-xs font-bold">t/s</span></span>
      {/if}
    </div>
    {#if usageLabel}
      <span
        class="arena-usage"
        aria-label={usageLabel}
        title="{usageLabel}{usageTotals.estimated ? ' (completion tokens estimated)' : ''}"
      >
        <span class="arena-usage-total">
          <span class="arena-usage-num">{formatTokenCount(usageTotals.total)}</span>
          <span class="arena-usage-unit">tok{usageTotals.estimated ? ' ~' : ''}</span>
        </span>
        <span class="arena-usage-cols">
          <span class="arena-usage-cell">
            <span class="arena-usage-k">in</span>
            <span class="arena-usage-num">{formatTokenCount(usageTotals.prompt)}</span>
          </span>
          <span class="arena-usage-cell">
            <span class="arena-usage-k">out</span>
            <span class="arena-usage-num">{formatTokenCount(usageTotals.completion)}</span>
          </span>
          <span class="arena-usage-cell">
            <span class="arena-usage-k">cache</span>
            <span class="arena-usage-num">{formatTokenCount(usageTotals.cached)}</span>
          </span>
        </span>
        <span class="arena-usage-cost">{usageTotals.priceKnown ? formatRunningUsd(usageTotals.cost) : 'cost unknown'}</span>
      </span>
    {:else}
      <span class="flex-1"></span>
    {/if}
    </div>
  </div>
  {:else}
    <div class="arena-col-placeholder flex-1 min-h-0 min-w-0" aria-hidden="true">{#if running}<span class="arena-ink text-[10.8px] font-bold">…</span>{/if}</div>
  {/if}
</div>

<style>
  .arena-slot-options {
    flex: 0 1 auto;
    min-height: 0;
    max-height: 50%;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .arena-column-body {
    min-width: 0;
    min-height: 30%;
    overflow-x: hidden;
    overflow-y: auto;
  }
  .arena-svg-frame {
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
  }
  .arena-svg-frame :global(svg) {
    display: block;
    max-width: 100%;
    height: auto;
  }
  .arena-svg-code {
    min-width: 0;
    max-width: 100%;
  }
  .arena-svg-code pre {
    max-width: 100%;
    overflow-x: auto;
    white-space: pre-wrap;
    font-size: 12px;
  }
  .arena-no-picture {
    font-size: 12px;
    font-weight: 700;
    color: var(--arena-read, #12161c);
  }
  .arena-visibility-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: 1px solid var(--arena-line, #4d5e74);
    background: transparent;
    color: var(--arena-read, #12161c);
    padding: 0;
  }
  .arena-place {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 4px 12px 4px 10px;
    border-radius: 12px;
    background: var(--ui-text-primary);
    color: var(--ui-bg-main);
  }
  .arena-place-n {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 32px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 0.9;
  }
  .arena-place-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    line-height: 1;
  }
  .arena-place-k {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .arena-place-rank {
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .arena-footer {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
  }
  .arena-footer-actions {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 0 0 auto;
    position: relative;
    z-index: 1;
  }
  .arena-panel-options-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--ui-border);
    background: var(--ui-input-bg);
    color: var(--ui-text-primary);
    font-size: 14px;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
  }
  .arena-footer-clear {
    padding: 4px 8px;
    border-radius: 8px;
    border: 0;
    background: transparent;
    color: var(--ui-text-secondary);
    font-size: 14px;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
  }
  .arena-footer-stats {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 8px;
    min-width: 0;
  }
  .arena-usage {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 0.3rem 0.45rem;
    flex: 1 1 auto;
    min-width: 0;
    overflow: visible;
    color: var(--ui-text-secondary);
  }
  .arena-usage-total,
  .arena-usage-cost {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    flex: 0 0 auto;
  }
  .arena-usage-total {
    display: inline-flex;
    align-items: baseline;
    gap: 0.2rem;
  }
  .arena-usage-unit {
    font-size: 10.8px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 1;
    color: var(--arena-read, #12161c);
  }
  .arena-usage-cols {
    display: grid;
    grid-template-columns: repeat(3, 5.8725rem);
    column-gap: 0.2rem;
    flex: 0 0 auto;
    min-width: calc(3 * 5.8725rem + 0.4rem);
  }
  .arena-usage-cell {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.25rem;
    min-width: 5.8725rem;
    overflow: hidden;
    padding: 1px 5px 2px;
    border-radius: 3px;
    border: 1px solid var(--arena-line, #4d5e74);
    background: var(--arena-cell, #e7eef6);
  }
  .arena-usage-k {
    font-size: 10.8px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 1;
    color: var(--arena-read, #12161c);
  }
  .arena-usage-num {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13.5px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    color: var(--arena-read, #12161c);
    line-height: 1.2;
  }
  .arena-usage-cost {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13.5px;
    font-weight: 800;
    color: var(--arena-read, #12161c);
    flex: 1 0 8.75rem;
    min-width: 8.75rem;
    text-align: right;
  }
</style>
