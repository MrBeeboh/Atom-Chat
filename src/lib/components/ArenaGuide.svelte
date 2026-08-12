<script>
  let {
    questionCount = 0,
    panelCount = 2,
    modelsReady = false,
    onLoadQuestions = () => {},
    onBuildQuestions = () => {},
    onOpenSettings = () => {},
  } = $props();

  const stepModels = $derived(modelsReady);
  const stepQuestions = $derived(questionCount > 0);
  const stepRun = $derived(questionCount > 0 && modelsReady);
</script>

<div
  class="arena-guide w-full max-w-xl mx-auto rounded-xl px-4 py-4 text-sm"
  style="background: var(--ui-bg-sidebar); border: 1px solid var(--ui-border);"
  role="region"
  aria-label="Arena quick start"
>
  <p class="font-semibold mb-1" style="color: var(--ui-text-primary);">Compare models side by side</p>
  <p class="text-xs mb-3" style="color: var(--ui-text-secondary);">
    Arena runs the same question through {panelCount} model{panelCount === 1 ? '' : 's'}, then scores answers automatically.
    Panel messages are not saved to chat history.
  </p>

  <ol class="space-y-2.5 list-none m-0 p-0 mb-4">
    <li class="flex gap-2.5 items-start">
      <span class="arena-step-icon" class:arena-step-done={stepModels} aria-hidden="true">{stepModels ? '✓' : '1'}</span>
      <div>
        <p class="text-xs font-medium" style="color: var(--ui-text-primary);">Choose models</p>
        <p class="text-[11px] mt-0.5" style="color: var(--ui-text-secondary);">
          Pick a different model in each panel header (A–{panelCount === 4 ? 'D' : panelCount === 3 ? 'C' : panelCount === 2 ? 'B' : 'A'}).
        </p>
      </div>
    </li>
    <li class="flex gap-2.5 items-start">
      <span class="arena-step-icon" class:arena-step-done={stepQuestions} aria-hidden="true">{stepQuestions ? '✓' : '2'}</span>
      <div>
        <p class="text-xs font-medium" style="color: var(--ui-text-primary);">Add questions</p>
        <p class="text-[11px] mt-0.5" style="color: var(--ui-text-secondary);">
          Paste a JSON or Q&amp;A list, or use <strong>Build</strong> to generate a set with the judge model.
        </p>
      </div>
    </li>
    <li class="flex gap-2.5 items-start">
      <span class="arena-step-icon" class:arena-step-done={stepRun} aria-hidden="true">{stepRun ? '✓' : '3'}</span>
      <div>
        <p class="text-xs font-medium" style="color: var(--ui-text-primary);">Run and score</p>
        <p class="text-[11px] mt-0.5" style="color: var(--ui-text-secondary);">
          Click <strong>Ask</strong> for one question, or <strong>Run all</strong> for the full set with judging after each round.
        </p>
      </div>
    </li>
  </ol>

  <div class="flex flex-wrap gap-2">
    <button
      type="button"
      class="px-3 py-2 rounded-lg text-xs font-semibold"
      style="background: var(--ui-accent); color: var(--ui-bg-main);"
      onclick={onLoadQuestions}
    >Load questions</button>
    <button
      type="button"
      class="px-3 py-2 rounded-lg text-xs font-semibold"
      style="border: 1px solid var(--ui-border); color: var(--ui-text-primary);"
      onclick={onBuildQuestions}
    >Build with AI</button>
    <button
      type="button"
      class="px-3 py-2 rounded-lg text-xs font-medium"
      style="border: 1px solid var(--ui-border); color: var(--ui-text-secondary);"
      onclick={onOpenSettings}
    >Arena settings</button>
  </div>
</div>

<style>
  .arena-step-icon {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
    background: color-mix(in srgb, var(--ui-border) 50%, transparent);
    color: var(--ui-text-secondary);
  }
  .arena-step-icon.arena-step-done {
    background: color-mix(in srgb, #22c55e 20%, transparent);
    color: #22c55e;
  }
</style>