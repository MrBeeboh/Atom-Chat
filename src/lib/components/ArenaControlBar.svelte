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

<!-- === Arena control bar: Setup (Build) | Execution (Q nav, Ask, Next, Run All, Web, Start Over) === -->
<div
  class="arena-question-bar shrink-0 flex items-center px-4 py-2.5 border-b gap-4"
  style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);"
>
  <!-- ═══ Arena Setup (same group style as Judge/Web) ═══ -->
  <div
    class="arena-bar-group flex items-center gap-2 shrink-0 rounded-lg pl-2.5 pr-2.5 py-1.5"
    style="background: color-mix(in srgb, var(--ui-accent) 8%, transparent);"
    aria-label="Arena Setup"
  >
    <span class="text-xs font-semibold uppercase tracking-wider shrink-0" style="color: var(--ui-text-secondary);">Setup</span>
    <button
      type="button"
      class="arena-bar-btn h-8 px-3 rounded-md text-xs font-semibold shrink-0 transition-opacity hover:opacity-90 disabled:opacity-50"
      style="border: 1px solid var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
      disabled={buildArenaInProgress}
      onclick={onBuildArena}
      aria-label="Build Arena (generate question set with judge)"
      title="Load judge, generate question set, then unload judge. Judge Internet Access is set in Arena Settings."
    >{buildArenaInProgress ? "Building…" : "Build Arena"}</button>
    {#if builtQuestionCount > 0}
      <span
        class="h-8 px-2.5 rounded-md text-xs font-semibold flex items-center"
        style="border: 1px solid var(--ui-border); color: var(--ui-text-primary); background: var(--ui-input-bg);"
        aria-label="{builtQuestionCount} questions in set"
      >{builtQuestionCount} Q</span>
    {/if}
  </div>

  <span class="w-px h-6 rounded-full shrink-0" style="background: var(--ui-border);" aria-hidden="true"></span>

  <!-- ═══ Arena Execution: Question nav + primary actions ═══ -->
  <div class="flex items-center gap-2 shrink-0" aria-label="Arena Execution">
  <div class="flex items-center gap-1 shrink-0" aria-label="Question navigation">
    <button
      type="button"
      class="arena-bar-btn flex items-center justify-center w-9 h-9 rounded-md text-sm font-bold disabled:opacity-25 transition-opacity hover:opacity-80"
      style="border: 1px solid var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
      disabled={currentQuestionTotal === 0 || currentQuestionNum <= 1}
      onclick={prevQuestion}
      aria-label="Previous question"
      title="Previous question"
    >◀</button>
    {#if currentQuestionTotal > 0}
      <select
        class="arena-bar-input h-9 min-w-24 max-w-56 pl-3 pr-7 text-sm font-semibold tabular-nums rounded-md cursor-pointer"
        style="border: 1px solid var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
        aria-label="Current question"
        value={currentQuestionNum}
        onchange={(e) => jumpToQuestion(e.currentTarget.value)}
      >
        {#each Array(currentQuestionTotal) as _, i}
          {@const q = parsedQuestions[i]}
          {@const qStr = q != null ? (typeof q === 'string' ? q : (q.text ?? '')) : ''}
          {@const qPreview = qStr ? qStr.slice(0, 40) + (qStr.length > 40 ? "…" : "") : ""}
          <option value={i + 1}>Q{i + 1} of {currentQuestionTotal}{qPreview ? ": " + qPreview : ""}</option>
        {/each}
      </select>
    {:else}
      <span class="px-3 text-sm font-semibold" style="color: var(--ui-text-secondary);">No questions</span>
    {/if}
    <button
      type="button"
      class="arena-bar-btn flex items-center justify-center w-9 h-9 rounded-md text-sm font-bold disabled:opacity-25 transition-opacity hover:opacity-80"
      style="border: 1px solid var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
      disabled={currentQuestionTotal === 0 || currentQuestionNum >= currentQuestionTotal}
      onclick={advanceQuestionIndex}
      aria-label="Next question"
      title="Next question"
    >▶</button>
  </div>

  <!-- Separator dot -->
  <span class="text-[8px] opacity-30 select-none" style="color: var(--ui-text-secondary);" aria-hidden="true">●</span>

  <!-- Ask / Next / Run All: one primary (Ask), rest secondary (same border+bg style) -->
  <div class="flex items-center gap-1.5 shrink-0" aria-label="Run actions">
    <button
      type="button"
      class="h-8 px-5 rounded-md text-xs font-bold shrink-0 disabled:opacity-40 transition-opacity"
      style="background: var(--ui-accent); color: var(--ui-bg-main); border: 1px solid transparent;"
      disabled={$isStreaming || currentQuestionTotal === 0}
      onclick={askCurrentQuestion}
      aria-label="Ask this question"
      title="Send the current question to all models"
    >Ask</button>
    <button
      type="button"
      class="arena-bar-btn h-8 px-4 rounded-md text-xs font-semibold shrink-0 disabled:opacity-40 transition-opacity"
      style="border: 1px solid var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
      disabled={$isStreaming || currentQuestionTotal === 0 || currentQuestionNum >= currentQuestionTotal}
      onclick={askNextQuestion}
      aria-label="Next question and ask"
      title="Advance to next question and send it"
    >Next</button>
    {#if runAllActive}
      <button
        type="button"
        class="h-8 px-3 rounded-md text-xs font-semibold shrink-0 transition-opacity"
        style="background: var(--ui-accent-hot, #dc2626); color: white; border: 1px solid transparent;"
        onclick={stopRunAll}
        title="Stop Run All"
      >Stop ({runAllProgress.current}/{runAllProgress.total})</button>
    {:else}
      <button
        type="button"
        class="arena-bar-btn h-8 px-3 rounded-md text-xs font-semibold shrink-0 disabled:opacity-40 transition-opacity"
        style="border: 1px solid var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
        disabled={$isStreaming || currentQuestionTotal < 2}
        onclick={runAllQuestions}
        aria-label="Run all questions"
        title="Run all questions sequentially with automated scoring"
      >Run All</button>
    {/if}
  </div>
  </div>
  <!-- end Arena Execution -->

  <!-- ═══ Judge: same group style as Setup/Web, same label style ═══ -->
  <div
    class="flex-1 min-w-2 flex items-center justify-center"
    aria-label="Judge (scoring model)"
  >
    <div
      class="arena-bar-group flex items-center gap-3 rounded-lg pl-2.5 pr-2.5 py-1.5"
      style="background: color-mix(in srgb, var(--ui-accent) 8%, transparent);"
    >
      <span class="text-xs font-semibold uppercase tracking-wider shrink-0" style="color: var(--ui-text-secondary);">Scoring model</span>
      <select
        id="arena-judge-select"
        class="arena-bar-input h-8 min-w-36 max-w-52 pl-3 pr-8 text-sm font-medium rounded-md cursor-pointer truncate"
        style="border: 1px solid var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
        aria-label="Override judge (scoring) model"
        title="Choose which model scores answers. Auto = largest non-contestant."
        value={$arenaScoringModelId || "__auto__"}
        onchange={(e) => {
          const v = e.currentTarget?.value;
          arenaScoringModelId.set(v === "__auto__" || !v ? "" : v);
          if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
        }}
      >
        <option value="__auto__">Auto (largest non-contestant)</option>
        {#each $models as m (m.id)}
          <option value={m.id}>{m.id}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- ═══ Web: same group + label style as Setup / Scoring model ═══ -->
  <div
    class="arena-bar-group flex items-center gap-2 rounded-lg pl-2.5 pr-2.5 py-1.5 shrink-0"
    style="background: color-mix(in srgb, var(--ui-accent) 8%, transparent);"
    aria-label="Send and score"
  >
    <span class="text-xs font-semibold uppercase tracking-wider shrink-0" style="color: var(--ui-text-secondary);">Web</span>
    <button
      type="button"
      class="arena-globe-btn arena-bar-btn relative flex items-center justify-center shrink-0 w-8 h-8 rounded-md transition-colors"
      class:arena-globe-active={$webSearchForNextMessage}
      style="border: 1px solid {$webSearchForNextMessage ? 'var(--ui-accent)' : 'var(--ui-border)'}; background: {$webSearchForNextMessage ? 'color-mix(in srgb, var(--ui-accent) 14%, transparent)' : 'var(--ui-input-bg)'};"
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
    <div
      class="arena-bar-input flex h-8 rounded-md overflow-hidden"
      style="border: 1px solid var(--ui-border); background: var(--ui-input-bg); opacity: {$webSearchForNextMessage && $webSearchConnected ? '1' : '0.5'};"
    >
      <button
        type="button"
        class="arena-web-tab h-full px-2.5 text-xs font-semibold min-w-0"
        class:active={$arenaWebSearchMode === "none"}
        style="color: var(--ui-text-primary);"
        onclick={() => {
          arenaWebSearchMode.set("none");
          if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
        }}
        title="Send &amp; scoring: no web search"
      >None</button>
      <button
        type="button"
        class="arena-web-tab h-full px-2.5 text-xs font-semibold border-l min-w-0"
        class:active={$arenaWebSearchMode === "all"}
        style="border-color: var(--ui-border); color: var(--ui-text-primary);"
        onclick={() => {
          arenaWebSearchMode.set("all");
          if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
        }}
        title="Send &amp; scoring: judge gets web context"
      >All</button>
    </div>
  </div>

  <span class="w-px h-6 rounded-full shrink-0" style="background: var(--ui-border);" aria-hidden="true"></span>

  <!-- Start Over: destructive = border + text only, same shape as secondary buttons -->
  <div class="flex items-center gap-1.5 shrink-0" aria-label="Tools">
    <button
      type="button"
      class="arena-bar-btn flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold shrink-0 transition-opacity hover:opacity-90"
      style="border: 1px solid var(--ui-accent-hot, #dc2626); color: var(--ui-accent-hot, #dc2626); background: transparent;"
      onclick={startOver}
      aria-label="Start over"
      title="Clear all responses, reset scores, go back to Q1"
    >
      <span aria-hidden="true">⟲</span>
      Start Over
    </button>
  </div>
</div>
