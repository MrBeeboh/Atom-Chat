<script>
  import {
    getThinkingProfile,
    resolveThinkingChoice,
    thinkingLevelLabel,
    thinkingSpeedLabel,
  } from '$lib/thinkingControls.js';

  let {
    modelId = '',
    thinking = '',
    speed = '',
    compact = false,
    onChange = (_patch) => {},
  } = $props();

  const profile = $derived(getThinkingProfile(modelId));
  const show = $derived(profile.thinkingLevels.length > 0);
  const choice = $derived(resolveThinkingChoice(modelId, { thinking, thinking_speed: speed }));
  const showSpeed = $derived(show && profile.speedLevels.length > 0 && choice.thinking !== 'off');

  function onThinkingInput(e) {
    onChange({ thinking: e.currentTarget.value });
  }
  function onSpeedInput(e) {
    onChange({ thinking_speed: e.currentTarget.value });
  }
</script>

{#if show}
  <div class="think-controls" class:think-controls-compact={compact} role="group" aria-label="Thinking and speed">
    <label class="think-field">
      <span class="think-label">Think</span>
      <select
        class="think-select"
        value={choice.thinking}
        onchange={onThinkingInput}
        aria-label="Thinking level"
        title="How hard this model thinks before answering. Saved for this model."
      >
        {#each profile.thinkingLevels as level (level)}
          <option value={level}>{thinkingLevelLabel(level)}</option>
        {/each}
      </select>
    </label>
    {#if showSpeed}
      <label class="think-field">
        <span class="think-label">Speed</span>
        <select
          class="think-select"
          value={choice.speed}
          onchange={onSpeedInput}
          aria-label="Thinking speed"
          title="Cap how long thinking can run. Fast cuts it short. Full lets it go."
        >
          {#each profile.speedLevels as level (level)}
            <option value={level}>{thinkingSpeedLabel(level)}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>
{/if}

<style>
  .think-controls {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  .think-controls-compact {
    align-items: stretch;
    gap: 4px;
    padding: 0 4px;
  }
  .think-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .think-label {
    font-size: 9px;
    line-height: 1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ui-text-secondary);
  }
  .think-select {
    font-size: 11px;
    line-height: 1.2;
    padding: 3px 4px;
    min-width: 64px;
    max-width: 88px;
    border-radius: 6px;
    border: 1px solid var(--ui-border);
    background: var(--ui-input-bg);
    color: var(--ui-text-primary);
  }
  .think-controls-compact .think-select {
    min-height: 22px;
    padding: 2px 2px 2px 4px;
  }
</style>
