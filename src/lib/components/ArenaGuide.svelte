<script>
  let {
    questionCount = 0,
    panelCount = 2,
    modelsReady = false,
    onLoadQuestions = () => {},
    onBuildQuestions = () => {},
    onOpenSettings = () => {},
  } = $props();
</script>

<div
  class="arena-guide w-full flex flex-wrap items-center gap-2"
  role="region"
  aria-label="Arena quick start"
>
  <p class="arena-guide-title">Compare</p>
  <button type="button" class="arena-guide-btn arena-guide-btn-primary" onclick={onLoadQuestions}>Load questions</button>
  <button type="button" class="arena-guide-btn" onclick={onBuildQuestions}>Build with AI</button>
  <button type="button" class="arena-guide-btn" onclick={onOpenSettings}>Arena settings</button>
</div>

<style>
  .arena-guide-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--ui-text-secondary);
  }
  .arena-guide-btn {
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 650;
    border: 1px solid var(--ui-border);
    color: var(--ui-text-primary);
    background: transparent;
  }
  .arena-guide-btn-primary {
    background: var(--ui-action, var(--ui-accent));
    color: var(--ui-action-ink, var(--ui-bg-main));
    border-color: transparent;
  }
</style>
