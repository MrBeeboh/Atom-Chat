<script>
  import { isStreaming } from "$lib/stores.js";

  let {
    currentQuestionNum = 0,
    currentQuestionTotal = 0,
    currentQuestionText = "",
    parsedQuestions = [],
    builtQuestionCount = 0,
    buildArenaInProgress = false,
    buildArenaError = "",
    runAllActive = false,
    runAllProgress = { current: 0, total: 0 },
    onOpenLoadModal = () => {},
    onBuildArena = () => {},
    prevQuestion = () => {},
    jumpToQuestion = (_num) => {},
    advanceQuestionIndex = () => {},
    askCurrentQuestion = () => {},
    askNextQuestion = () => {},
    runAllQuestions = () => {},
    runAllButtonTitle = "Run every question in order; judge scores after each",
    stopRunAll = () => {},
    startOver = () => {},
    onToggleQuestionPanel = () => {},
    arenaWebWarmingUp = false,
    resetWebWarmUpAttempted = () => {},
    runArenaWarmUp = () => {},
  } = $props();

  let questionSelectTitle = $derived(
    currentQuestionText?.trim() ||
    (currentQuestionTotal > 0 ? `Question ${currentQuestionNum} of ${currentQuestionTotal}` : "")
  );
  let hasQuestions = $derived(currentQuestionTotal > 0);
</script>

<div class="arena-command-toolbar" role="toolbar" aria-label="Arena run controls">
  <div class="arena-tool-start">
    {#if hasQuestions}
      <button type="button" class="arena-btn arena-btn-quiet" onclick={onOpenLoadModal} title="Replace or add question set">Replace…</button>
    {:else}
      <button type="button" class="arena-btn arena-btn-primary" onclick={onOpenLoadModal} title="Import JSON or Q&A text, or generate with AI">Load questions</button>
    {/if}
    <button
      type="button"
      class="arena-btn"
      disabled={buildArenaInProgress}
      onclick={onBuildArena}
      title="Generate questions using the judge model"
    >{buildArenaInProgress ? "Building…" : "Build"}</button>
    {#if buildArenaError}
      <span class="arena-build-error" title={buildArenaError}>{buildArenaError}</span>
    {/if}
    {#if builtQuestionCount > 0 && builtQuestionCount !== currentQuestionTotal}
      <span class="arena-built-count" title="Built questions not in the current set">{builtQuestionCount} built</span>
    {/if}
  </div>

  <div class="arena-tool-run" aria-label="Run questions">
    <div class="arena-stepper">
      <button
        type="button"
        disabled={!hasQuestions || currentQuestionNum <= 1}
        onclick={prevQuestion}
        title="Previous question"
        aria-label="Previous question"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" /></svg>
      </button>
      {#if hasQuestions}
        <select
          title={questionSelectTitle}
          value={currentQuestionNum}
          onchange={(e) => jumpToQuestion(e.currentTarget.value)}
        >
          {#each Array(currentQuestionTotal) as _, i (i)}
            <option value={i + 1}>Q{i + 1} / {currentQuestionTotal}</option>
          {/each}
        </select>
      {:else}
        <span class="arena-stepper-empty">No questions</span>
      {/if}
      <button
        type="button"
        disabled={!hasQuestions || currentQuestionNum >= currentQuestionTotal}
        onclick={advanceQuestionIndex}
        title="Next question"
        aria-label="Next question"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6" /></svg>
      </button>
    </div>
    {#if hasQuestions}
      <button
        type="button"
        class="arena-btn arena-btn-quiet arena-icon"
        onclick={onToggleQuestionPanel}
        title="Show question in floating panel"
        aria-label="Show question in floating panel"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
      </button>
    {/if}
    <button
      type="button"
      class="arena-btn"
      class:arena-btn-primary={hasQuestions}
      disabled={$isStreaming || !hasQuestions}
      onclick={askCurrentQuestion}
      title="Send the current question to every active panel"
    >Ask</button>
    <button
      type="button"
      class="arena-btn"
      disabled={$isStreaming || !hasQuestions || currentQuestionNum >= currentQuestionTotal}
      onclick={askNextQuestion}
      title="Advance to the next question and send it"
    >Next</button>
    {#if runAllActive}
      <button type="button" class="arena-btn arena-btn-stop" onclick={stopRunAll} title="Stop Run All">
        Stop {runAllProgress.current}/{runAllProgress.total}
      </button>
    {:else}
      <button
        type="button"
        class="arena-btn"
        class:arena-btn-muted={!runAllActive && ($isStreaming || currentQuestionTotal < 2)}
        onclick={runAllQuestions}
        title={runAllButtonTitle}
        aria-label={runAllButtonTitle}
      >Run all</button>
    {/if}
  </div>

  <div class="arena-tool-end">
    <button
      type="button"
      class="arena-btn arena-btn-quiet"
      onclick={startOver}
      title="Clear all responses, reset scores, go back to question 1"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
      Reset
    </button>
  </div>
</div>

<style>
  .arena-command-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    width: auto;
    min-height: 0;
    padding: 0;
    box-sizing: border-box;
  }
  .arena-tool-start,
  .arena-tool-run,
  .arena-tool-end {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .arena-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--ui-border);
    background: var(--ui-input-bg);
    color: var(--ui-text-primary);
    font-size: 12px;
    font-weight: 650;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
  }
  .arena-btn svg {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
  }
  .arena-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .arena-btn-primary {
    border-color: transparent;
    background: var(--ui-action, var(--ui-accent));
    color: var(--ui-action-ink, var(--ui-bg-main));
  }
  .arena-btn-quiet {
    background: transparent;
    color: var(--ui-text-secondary);
  }
  .arena-btn-stop {
    border-color: var(--ui-accent-hot, #9f2d2d);
    color: var(--ui-accent-hot, #9f2d2d);
    background: color-mix(in srgb, var(--ui-accent-hot, #9f2d2d) 8%, var(--ui-input-bg));
    font-weight: 700;
  }
  .arena-btn-muted:not(:disabled) {
    opacity: 0.72;
  }
  .arena-icon {
    width: 30px;
    padding: 0;
  }
  .arena-stepper {
    display: inline-flex;
    align-items: stretch;
    height: 30px;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: var(--ui-input-bg);
    overflow: hidden;
  }
  .arena-stepper button {
    width: 28px;
    border: 0;
    background: transparent;
    color: var(--ui-text-primary);
    cursor: pointer;
  }
  .arena-stepper button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .arena-stepper svg {
    width: 14px;
    height: 14px;
    display: block;
    margin: 0 auto;
  }
  .arena-stepper select {
    width: 5.6rem;
    border: 0;
    border-left: 1px solid var(--ui-border);
    border-right: 1px solid var(--ui-border);
    background: transparent;
    color: var(--ui-text-primary);
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
    cursor: pointer;
  }
  .arena-stepper-empty {
    display: flex;
    align-items: center;
    padding: 0 10px;
    border-left: 1px solid var(--ui-border);
    border-right: 1px solid var(--ui-border);
    color: var(--ui-text-secondary);
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
  }
  .arena-build-error,
  .arena-built-count {
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 650;
  }
  .arena-build-error { color: var(--ui-accent-hot, #9f2d2d); }
  .arena-built-count { color: var(--ui-text-secondary); }
</style>
