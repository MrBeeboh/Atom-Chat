<script>
  import { playClick } from "$lib/audio.js";
  import {
    arenaWebSearchMode,
    webSearchForNextMessage,
    webSearchConnected,
    isStreaming,
    settings,
    models,
    arenaScoringModelId,
  } from "$lib/stores.js";

  // Props
  export let currentQuestionNum = 0;
  export let currentQuestionTotal = 0;
  export let parsedQuestions = [];
  export let builtQuestionCount = 0;
  export let buildArenaInProgress = false;
  export let runAllActive = false;
  export let runAllProgress = { current: 0, total: 0 };
  export let arenaWebWarmingUp = false;
  export let arenaWebWarmUpAttempted = false;

  // Callbacks (parent handles)
  export let onBuildArena = () => {};
  export let prevQuestion = () => {};
  export let jumpToQuestion = (_num) => {};
  export let advanceQuestionIndex = () => {};
  export let askCurrentQuestion = () => {};
  export let askNextQuestion = () => {};
  export let runAllQuestions = () => {};
  export let stopRunAll = () => {};
  export let runArenaWarmUp = () => {};
  export let startOver = () => {};
</script>

<!-- === Arena control bar: Setup | Execution | Scoring | Web | Tools === -->
<div
  class="arena-question-bar shrink-0 flex items-center px-4 py-2.5 gap-4 flex-wrap"
  style="background: color-mix(in srgb, var(--ui-accent) 4%, var(--ui-bg-sidebar));"
  role="toolbar"
>
  <div
    class="flex items-center gap-2 shrink-0"
    aria-label="Arena Setup"
  >
    <span class="text-[11px] font-medium uppercase tracking-wide shrink-0" style="color: var(--ui-text-secondary);">Setup</span>
    <button
      type="button"
      class="h-8 px-3 rounded-lg text-xs font-semibold shrink-0 transition-opacity hover:opacity-90 disabled:opacity-50"
      style="background: var(--ui-input-bg); color: var(--ui-text-primary);"
      disabled={buildArenaInProgress}
      onclick={onBuildArena}
      aria-label="Build Arena (generate question set with judge)"
      title="Load judge, generate question set, then unload judge. Judge Internet Access is set in Arena Settings."
    >{buildArenaInProgress ? "Building…" : "Build Arena"}</button>
    {#if builtQuestionCount > 0}
      <span
        class="h-8 px-2.5 rounded-lg text-xs font-medium flex items-center"
        style="color: var(--ui-text-secondary);"
        aria-label="{builtQuestionCount} questions in set"
      >{builtQuestionCount} Q</span>
    {/if}
  </div>

  <div class="flex items-center gap-2 shrink-0" aria-label="Question and run">
    <div class="flex items-center gap-0.5 shrink-0" aria-label="Question navigation">
      <button
        type="button"
        class="flex items-center justify-center w-8 h-8 rounded-lg text-sm font-medium disabled:opacity-30 transition-opacity hover:opacity-80"
        style="background: var(--ui-input-bg); color: var(--ui-text-primary);"
        disabled={currentQuestionTotal === 0 || currentQuestionNum <= 1}
        onclick={prevQuestion}
        aria-label="Previous question"
        title="Previous question"
      >◀</button>
      {#if currentQuestionTotal > 0}
        <select
          class="h-8 min-w-20 max-w-48 pl-2.5 pr-6 text-sm font-medium tabular-nums rounded-lg cursor-pointer"
          style="background: var(--ui-input-bg); color: var(--ui-text-primary);"
          aria-label="Current question"
          value={currentQuestionNum}
          onchange={(e) => jumpToQuestion(e.currentTarget.value)}
        >
          {#each Array(currentQuestionTotal) as _, i}
            {@const q = parsedQuestions[i]}
            {@const qStr = q != null ? (typeof q === 'string' ? q : (q.text ?? '')) : ''}
            {@const qPreview = qStr ? qStr.slice(0, 40) + (qStr.length > 40 ? "…" : "") : ""}
            <option value={i + 1}>Q{i + 1}{qPreview ? ": " + qPreview : ""}</option>
          {/each}
        </select>
      {:else}
        <span class="px-2 text-sm" style="color: var(--ui-text-secondary);">No questions</span>
      {/if}
      <button
        type="button"
        class="flex items-center justify-center w-8 h-8 rounded-lg text-sm font-medium disabled:opacity-30 transition-opacity hover:opacity-80"
        style="background: var(--ui-input-bg); color: var(--ui-text-primary);"
        disabled={currentQuestionTotal === 0 || currentQuestionNum >= currentQuestionTotal}
        onclick={advanceQuestionIndex}
        aria-label="Next question"
        title="Next question"
      >▶</button>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        class="h-8 px-4 rounded-lg text-xs font-bold shrink-0 disabled:opacity-40 transition-opacity"
        style="background: var(--ui-accent); color: var(--ui-bg-main);"
        disabled={$isStreaming || currentQuestionTotal === 0}
        onclick={askCurrentQuestion}
        aria-label="Ask this question"
        title="Send the current question to all models"
      >Ask</button>
      <button
        type="button"
        class="h-8 px-3 rounded-lg text-xs font-medium shrink-0 disabled:opacity-40 transition-opacity hover:opacity-90"
        style="background: var(--ui-input-bg); color: var(--ui-text-primary);"
        disabled={$isStreaming || currentQuestionTotal === 0 || currentQuestionNum >= currentQuestionTotal}
        onclick={askNextQuestion}
        aria-label="Next question and ask"
        title="Advance to next question and send it"
      >Next</button>
      {#if runAllActive}
        <button
          type="button"
          class="h-8 px-3 rounded-lg text-xs font-semibold shrink-0 transition-opacity"
          style="background: var(--ui-accent-hot, #dc2626); color: white;"
          onclick={stopRunAll}
          title="Stop Run All"
        >Stop ({runAllProgress.current}/{runAllProgress.total})</button>
      {:else}
        <button
          type="button"
          class="h-8 px-3 rounded-lg text-xs font-medium shrink-0 disabled:opacity-40 transition-opacity hover:opacity-90"
          style="background: var(--ui-input-bg); color: var(--ui-text-primary);"
          disabled={$isStreaming || currentQuestionTotal < 2}
          onclick={runAllQuestions}
          aria-label="Run all questions"
          title="Run all questions sequentially with automated scoring"
        >Run All</button>
      {/if}
    </div>
  </div>

  <div class="flex items-center gap-2 shrink-0" aria-label="Scoring model">
    <span class="text-[11px] font-medium uppercase tracking-wide shrink-0" style="color: var(--ui-text-secondary);">Scoring</span>
    <select
      id="arena-judge-select"
      class="h-8 min-w-32 max-w-44 pl-2.5 pr-7 text-sm font-medium rounded-lg cursor-pointer truncate"
      style="background: var(--ui-input-bg); color: var(--ui-text-primary);"
      aria-label="Override judge (scoring) model"
      title="Choose which model scores answers. Auto = largest non-contestant."
      value={$arenaScoringModelId || "__auto__"}
      onchange={(e) => {
        const v = e.currentTarget?.value;
        arenaScoringModelId.set(v === "__auto__" || !v ? "" : v);
        if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
      }}
    >
      <option value="__auto__">Auto</option>
      {#each $models as m (m.id)}
        <option value={m.id}>{m.id}</option>
      {/each}
    </select>
  </div>

  <div class="flex items-center gap-2 shrink-0" aria-label="Web search">
    <span class="text-[11px] font-medium uppercase tracking-wide shrink-0" style="color: var(--ui-text-secondary);">Web</span>
    <button
      type="button"
      class="arena-globe-btn relative flex items-center justify-center shrink-0 w-8 h-8 rounded-lg transition-opacity hover:opacity-90"
      class:arena-globe-active={$webSearchForNextMessage}
      style="background: {$webSearchForNextMessage ? 'color-mix(in srgb, var(--ui-accent) 18%, var(--ui-input-bg))' : 'var(--ui-input-bg)'};"
      disabled={$isStreaming}
      title={arenaWebWarmingUp ? "Connecting…" : $webSearchForNextMessage ? ($webSearchConnected ? "Connected – click to disconnect" : "Not connected – click to retry") : "Connect to internet"}
      onclick={() => {
        const on = $webSearchForNextMessage;
        const connected = $webSearchConnected;
        if (on && !connected && !arenaWebWarmingUp) {
          arenaWebWarmUpAttempted = false;
          runArenaWarmUp();
          return;
        }
        if (on) {
          webSearchForNextMessage.set(false);
          webSearchConnected.set(false);
          return;
        }
        webSearchForNextMessage.set(true);
        runArenaWarmUp();
      }}
      aria-label={arenaWebWarmingUp ? "Connecting" : $webSearchForNextMessage ? "Web connected" : "Connect to web"}
      aria-pressed={$webSearchForNextMessage}
    >
      <span class="text-base leading-none" class:arena-globe-spin={arenaWebWarmingUp} aria-hidden="true">🌐</span>
      {#if $webSearchForNextMessage}
        {#if $webSearchConnected}
          <span class="arena-globe-dot arena-globe-dot-green" aria-hidden="true"></span>
        {:else}
          <span class="arena-globe-dot arena-globe-dot-red" class:arena-globe-dot-pulse={arenaWebWarmingUp} aria-hidden="true"></span>
        {/if}
      {/if}
    </button>
    <div class="flex h-8 rounded-lg overflow-hidden" style="background: var(--ui-input-bg); opacity: {$webSearchForNextMessage && $webSearchConnected ? '1' : '0.6'};">
      <button
        type="button"
        class="arena-web-tab h-full px-2.5 text-xs font-medium min-w-0"
        class:active={$arenaWebSearchMode === "none"}
        style="color: var(--ui-text-primary);"
        onclick={() => {
          arenaWebSearchMode.set("none");
          if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
        }}
        title="No web search"
      >None</button>
      <button
        type="button"
        class="arena-web-tab h-full px-2.5 text-xs font-medium min-w-0"
        class:active={$arenaWebSearchMode === "all"}
        style="color: var(--ui-text-primary);"
        onclick={() => {
          arenaWebSearchMode.set("all");
          if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
        }}
        title="Judge gets web context"
      >All</button>
    </div>
  </div>

  <button
    type="button"
    class="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium shrink-0 transition-opacity hover:opacity-90"
    style="color: var(--ui-accent-hot, #dc2626);"
    onclick={startOver}
    aria-label="Start over"
    title="Clear all responses, reset scores, go back to Q1"
  >
    <span aria-hidden="true">⟲</span>
    Start Over
  </button>
</div>
