<script>
  import { playClick } from "$lib/audio.js";
  import { isStreaming, settings } from "$lib/stores.js";

  // Props
  export let currentQuestionNum = 0;
  export let currentQuestionTotal = 0;
  /** Full text of the current question (tooltip on selector). */
  export let currentQuestionText = "";
  export let parsedQuestions = [];
  export let builtQuestionCount = 0;
  export let buildArenaInProgress = false;
  export let buildArenaError = "";
  export let runAllActive = false;
  export let runAllProgress = { current: 0, total: 0 };

  /** Opens Load questions modal (Build + quick import) */
  export let onOpenLoadModal = () => {};

  // Callbacks (parent handles)
  export let onBuildArena = () => {};
  export let prevQuestion = () => {};
  export let jumpToQuestion = (_num) => {};
  export let advanceQuestionIndex = () => {};
  export let askCurrentQuestion = () => {};
  export let askNextQuestion = () => {};
  export let runAllQuestions = () => {};
  export let stopRunAll = () => {};
  export let startOver = () => {};
  export let onToggleQuestionPanel = () => {};

  $: questionSelectTitle =
    currentQuestionText?.trim() ||
    (currentQuestionTotal > 0 ? `Question ${currentQuestionNum} of ${currentQuestionTotal}` : "");
</script>

<!-- Toolbar: three-zone layout (left · center · right) -->
<div
  class="arena-command-toolbar shrink-0 px-3 sm:px-4 py-2 flex items-center gap-3 border-t"
  style="background: color-mix(in srgb, var(--ui-bg-main) 88%, var(--ui-accent) 4%); border-color: color-mix(in srgb, var(--ui-border) 65%, transparent);"
  role="toolbar"
  aria-label="Arena run controls"
>
  <!-- LEFT: Setup -->
  <div class="flex items-center gap-2 shrink-0">
    {#if currentQuestionTotal === 0}
      <button
        type="button"
        class="h-8 px-3.5 rounded-lg text-xs font-bold shrink-0 transition-all hover:opacity-92 active:scale-[0.98] shadow-sm"
        style="background: var(--ui-accent); color: var(--ui-bg-main);"
        onclick={onOpenLoadModal}
        title="Load or build a question set"
      >Load questions</button>
    {:else}
      <button
        type="button"
        class="h-8 px-2.5 rounded-lg text-[11px] font-semibold shrink-0 transition-opacity hover:opacity-90 underline-offset-2 hover:underline"
        style="color: var(--ui-accent); background: transparent;"
        onclick={onOpenLoadModal}
        title="Replace or add question set"
      >Replace…</button>
    {/if}

    <button
      type="button"
      class="h-8 px-3 rounded-lg text-xs font-semibold shrink-0 transition-all hover:opacity-90 disabled:opacity-45 border shadow-sm"
      style="background: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
      disabled={buildArenaInProgress}
      onclick={onBuildArena}
      title="Generate question set with judge model"
    >{buildArenaInProgress ? "Building…" : "Build"}</button>

    {#if buildArenaError}
      <span class="text-[11px] font-medium truncate max-w-[16rem]" style="color: var(--ui-accent-hot, #dc2626);" title={buildArenaError}>{buildArenaError}</span>
    {/if}

    {#if builtQuestionCount > 0}
      <span
        class="h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center border tabular-nums"
        style="color: var(--ui-text-secondary); border-color: var(--ui-border); background: color-mix(in srgb, var(--ui-border) 12%, transparent);"
      >{builtQuestionCount} Q</span>
    {/if}
  </div>

  <!-- CENTER: Question nav + Run actions (pushed to center with flex-1 spacers) -->
  <div class="flex-1 flex items-center justify-center gap-2 min-w-0">
    <!-- Question nav -->
    <div class="flex items-center gap-1 flex-1 min-w-0">
      <button
        type="button"
        class="flex items-center justify-center w-8 h-8 rounded-lg text-sm font-medium disabled:opacity-35 transition-all hover:opacity-85 border shadow-sm shrink-0"
        style="background: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
        disabled={currentQuestionTotal === 0 || currentQuestionNum <= 1}
        onclick={prevQuestion}
        title="Previous question"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" /></svg>
      </button>
      {#if currentQuestionTotal > 0}
        <select
          class="h-8 flex-1 min-w-0 pl-2.5 pr-7 text-xs font-semibold tabular-nums rounded-lg cursor-pointer border shadow-sm truncate"
          style="background: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
          title={questionSelectTitle}
          value={currentQuestionNum}
          onchange={(e) => jumpToQuestion(e.currentTarget.value)}
        >
          {#each Array(currentQuestionTotal) as _, i}
            {@const q = parsedQuestions[i]}
            {@const qStr = q != null ? (typeof q === "string" ? q : (q.text ?? "")) : ""}
            {@const qPreview = qStr ? qStr.slice(0, 36) + (qStr.length > 36 ? "…" : "") : ""}
            <option value={i + 1}>Q{i + 1}{qPreview ? ": " + qPreview : ""}</option>
          {/each}
        </select>
      {:else}
        <span class="px-1.5 text-sm tabular-nums" style="color: var(--ui-text-secondary);">—</span>
      {/if}
      <button
        type="button"
        class="flex items-center justify-center w-8 h-8 rounded-lg text-sm font-medium disabled:opacity-35 transition-all hover:opacity-85 border shadow-sm shrink-0"
        style="background: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
        disabled={currentQuestionTotal === 0 || currentQuestionNum >= currentQuestionTotal}
        onclick={advanceQuestionIndex}
        title="Next question"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6" /></svg>
      </button>
      {#if currentQuestionTotal > 0}
        <button
          type="button"
          class="flex items-center justify-center w-8 h-8 rounded-lg disabled:opacity-35 transition-all hover:opacity-85 shrink-0"
          style="color: var(--ui-text-secondary);"
          onclick={onToggleQuestionPanel}
          title="Show question in floating panel"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
        </button>
      {/if}
    </div>

    <!-- Separator -->
    <div class="w-px h-5 shrink-0" style="background: color-mix(in srgb, var(--ui-border) 60%, transparent);"></div>

    <!-- Run actions -->
    <div class="flex items-center gap-2 shrink-0">
      <button
        type="button"
        class="h-8 px-3.5 rounded-lg text-xs font-bold shrink-0 disabled:opacity-40 transition-all hover:opacity-92 active:scale-[0.98] shadow-sm"
        style="background: var(--ui-accent); color: var(--ui-bg-main);"
        disabled={$isStreaming || currentQuestionTotal === 0}
        onclick={askCurrentQuestion}
        title="Send current question to all models"
      >Ask</button>
      <button
        type="button"
        class="h-8 px-3 rounded-lg text-xs font-semibold shrink-0 disabled:opacity-40 transition-all border shadow-sm hover:opacity-90"
        style="background: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
        disabled={$isStreaming || currentQuestionTotal === 0 || currentQuestionNum >= currentQuestionTotal}
        onclick={askNextQuestion}
        title="Advance to next question and send it"
      >Next</button>
      {#if runAllActive}
        <button
          type="button"
          class="h-8 px-3 rounded-lg text-xs font-bold shrink-0 transition-all border-2 hover:opacity-95 active:scale-[0.98]"
          style="border-color: var(--ui-accent-hot, #dc2626); color: var(--ui-accent-hot, #dc2626); background: color-mix(in srgb, var(--ui-accent-hot, #dc2626) 8%, transparent);"
          onclick={stopRunAll}
          title="Stop Run All"
        >Stop ({runAllProgress.current}/{runAllProgress.total})</button>
      {:else}
        <button
          type="button"
          class="h-8 px-2.5 rounded-lg text-xs font-semibold shrink-0 disabled:opacity-40 transition-all border shadow-sm hover:opacity-90"
          style="background: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
          disabled={$isStreaming || currentQuestionTotal < 2}
          onclick={runAllQuestions}
          title="Run all questions sequentially with scoring"
        >Run All</button>
      {/if}
    </div>
  </div>

  <!-- RIGHT: Reset -->
  <div class="shrink-0">
    <button
      type="button"
      class="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold transition-all border shadow-sm hover:opacity-90"
      style="color: var(--ui-accent-hot, #dc2626); border-color: color-mix(in srgb, var(--ui-accent-hot, #dc2626) 35%, var(--ui-border)); background: color-mix(in srgb, var(--ui-accent-hot, #dc2626) 6%, var(--ui-input-bg));"
      onclick={startOver}
      title="Clear all responses, reset scores, go back to Q1"
    >
      <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
      Reset
    </button>
  </div>
</div>
