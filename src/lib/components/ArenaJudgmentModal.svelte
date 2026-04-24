<script>
  const LABELS = ['A', 'B', 'C', 'D'];
  const COLORS = {
    A: '#f59e0b',
    B: '#3b82f6',
    C: '#10b981',
    D: '#ec4899',
  };

  let {
    judgmentPopup = null,
    judgmentPopupPos = $bindable({ x: 100, y: 100 }),
    arenaCurrentRunMeta = null,
    reExtractBusy = false,
    onRetryParse = () => {},
    onReExtract = () => {},
    onDismiss = () => {},
  } = $props();

  // Debug judgmentPopup changes
  $effect(() => {
    if (typeof console !== "undefined" && console.log) {
      console.log("[ArenaJudgmentModal debug] judgmentPopup changed:", {
        judgmentPopup: judgmentPopup ? { ...judgmentPopup } : null,
        hasScores: !!judgmentPopup && !!judgmentPopup.scores && Object.keys(judgmentPopup.scores).length > 0,
        scoreCount: judgmentPopup && judgmentPopup.scores ? Object.keys(judgmentPopup.scores).length : 0
      });
    }
  });

  let tab = $state('scores');
  let dragging = $state(false);
  let dragStart = $state({ x: 0, y: 0, x0: 0, y0: 0 });

  $effect(() => {
    if (!judgmentPopup) {
      tab = 'scores';
    }
  });

  function startDrag(e) {
    if (e.cancelable) e.preventDefault();
    const x = e.clientX ?? e.touches?.[0]?.clientX;
    const y = e.clientY ?? e.touches?.[0]?.clientY;
    if (x == null || y == null) return;
    dragging = true;
    dragStart = { x, y, x0: judgmentPopupPos?.x ?? 100, y0: judgmentPopupPos?.y ?? 100 };
  }

  function moveDrag(e) {
    if (!dragging) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX;
    const y = e.clientY ?? e.touches?.[0]?.clientY;
    if (x == null || y == null) return;
    judgmentPopupPos = {
      x: Math.max(0, dragStart.x0 + x - dragStart.x),
      y: Math.max(0, dragStart.y0 + y - dragStart.y),
    };
  }

  function endDrag() {
    dragging = false;
  }

  $effect(() => {
    if (!dragging) return;
    const onMove = (e) => moveDrag(e);
    const onEnd = () => endDrag();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  });

  function scoreColor(score) {
    if (score >= 8) return '#10b981';
    if (score >= 6) return '#f59e0b';
    return '#ef4444';
  }

  function slotOrder() {
    const s = judgmentPopup?.scores;
    if (!s) return [];
    return LABELS.filter((l) => s[l] != null).map((l) => [l, s[l]]);
  }
</script>

{#if judgmentPopup}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="judgment-modal"
    role="dialog"
    aria-label="Round judgment scores"
    class:dragging
    style="left: {judgmentPopupPos?.x ?? 0}px; top: {judgmentPopupPos?.y ?? 0}px;"
  >
    <!-- Header (drag handle) -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="judgment-header"
      onmousedown={startDrag}
      ontouchstart={startDrag}
    >
      <div class="judgment-header-left">
        <span class="judgment-title">Round {judgmentPopup.questionIndex != null ? judgmentPopup.questionIndex + 1 : '?'}</span>
        {#if arenaCurrentRunMeta?.judge_model}
          <span class="judgment-judge">judged by {arenaCurrentRunMeta.judge_model}</span>
        {/if}
      </div>
      <button
        type="button"
        class="judgment-close"
        onclick={onDismiss}
        aria-label="Close"
      >×</button>
    </div>

    <!-- Tabs -->
    <div class="judgment-tabs">
      <button
        type="button"
        class="judgment-tab"
        class:active={tab === 'scores'}
        onclick={() => tab = 'scores'}
      >Scores</button>
      <button
        type="button"
        class="judgment-tab"
        class:active={tab === 'raw'}
        onclick={() => tab = 'raw'}
      >Raw Output</button>
    </div>

    {#if tab === 'scores'}
      <!-- Score cards -->
      <div class="judgment-cards">
        {#each slotOrder() as [slot, score]}
          {@const color = COLORS[slot] ?? '#888'}
          {@const modelEntry = arenaCurrentRunMeta?.model_list?.find((m) => m.slot === slot)}
          <div class="judgment-card" style="border-left: 3px solid {color};">
            <div class="judgment-card-top">
              <span class="judgment-card-label" style="color: {color};">Model {slot}{modelEntry ? ` — ${modelEntry.model_id}` : ''}</span>
              <span class="judgment-card-score" style="color: {scoreColor(score)};">{score}<span class="judgment-card-total">/10</span></span>
            </div>
            {#if judgmentPopup.explanations?.[slot]}
              <p class="judgment-card-explain">{judgmentPopup.explanations[slot]}</p>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Combined explanation fallback -->
      {#if judgmentPopup.explanation && (!judgmentPopup.explanations || Object.keys(judgmentPopup.explanations).length === 0)}
        <div class="judgment-explain-block">
          <p class="judgment-explain-text">{judgmentPopup.explanation}</p>
        </div>
      {/if}
    {:else}
      <!-- Raw output -->
      <div class="judgment-raw-block">
        <pre class="judgment-raw-text">{judgmentPopup.rawJudgeOutput || judgmentPopup.explanation || ''}</pre>
      </div>
    {/if}

    <!-- Footer actions -->
    <div class="judgment-footer">
      <button
        type="button"
        class="judgment-btn"
        onclick={onRetryParse}
      >Retry Parse</button>
      <button
        type="button"
        class="judgment-btn judgment-btn-accent"
        disabled={reExtractBusy}
        onclick={onReExtract}
      >{reExtractBusy ? 'Re-extracting…' : 'AI Re-extract'}</button>
    </div>
  </div>
{/if}

<style>
  .judgment-modal {
    position: fixed;
    z-index: 9999;
    width: 380px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    background: var(--ui-bg-main);
    border: 1px solid var(--ui-border);
    border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.35);
    overflow: hidden;
    cursor: default;
    user-select: none;
  }
  .judgment-modal.dragging {
    opacity: 0.92;
    transition: none;
  }

  .judgment-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 8px;
    cursor: grab;
    border-bottom: 1px solid var(--ui-border);
  }
  .dragging .judgment-header {
    cursor: grabbing;
  }
  .judgment-header-left {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .judgment-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--ui-text-primary);
  }
  .judgment-judge {
    font-size: 11px;
    color: var(--ui-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .judgment-close {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-secondary);
    font-size: 18px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .judgment-close:hover {
    background: color-mix(in srgb, var(--ui-border) 30%, transparent);
    color: var(--ui-text-primary);
  }

  .judgment-tabs {
    display: flex;
    gap: 0;
    padding: 0 14px;
    border-bottom: 1px solid var(--ui-border);
  }
  .judgment-tab {
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    border: none;
    background: transparent;
    color: var(--ui-text-secondary);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .judgment-tab.active {
    color: var(--ui-accent);
    border-bottom-color: var(--ui-accent);
  }
  .judgment-tab:hover:not(.active) {
    color: var(--ui-text-primary);
  }

  .judgment-cards {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
  }
  .judgment-card {
    padding: 10px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--ui-bg-sidebar) 60%, var(--ui-bg-main));
  }
  .judgment-card-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .judgment-card-label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .judgment-card-score {
    font-size: 22px;
    font-weight: 800;
    line-height: 1;
    flex-shrink: 0;
  }
  .judgment-card-total {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text-secondary);
  }
  .judgment-card-explain {
    margin: 5px 0 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--ui-text-secondary);
    word-break: break-word;
  }

  .judgment-explain-block {
    padding: 0 14px 10px;
    overflow-y: auto;
    flex: 1;
  }
  .judgment-explain-text {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ui-text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .judgment-raw-block {
    padding: 10px 14px;
    overflow-y: auto;
    flex: 1;
  }
  .judgment-raw-text {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--ui-text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  }

  .judgment-footer {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--ui-border);
    justify-content: flex-end;
  }
  .judgment-btn {
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: transparent;
    color: var(--ui-text-primary);
    cursor: pointer;
  }
  .judgment-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-border) 20%, transparent);
  }
  .judgment-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .judgment-btn-accent {
    background: var(--ui-accent);
    color: var(--ui-bg-main);
    border-color: var(--ui-accent);
  }
  .judgment-btn-accent:hover:not(:disabled) {
    filter: brightness(1.1);
  }
</style>
