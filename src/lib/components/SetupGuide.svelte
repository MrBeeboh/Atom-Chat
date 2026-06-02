<script>
  import {
    lmStudioConnected,
    cloudApisAvailable,
    models,
    effectiveModelId,
    settingsOpen,
    settingsFocus,
  } from '$lib/stores.js';
  import { refreshConnectionAndModels, deriveSetupStatus } from '$lib/connectionSetup.js';

  let refreshing = $state(false);
  let status = $derived(deriveSetupStatus());

  const stepLm = $derived(
    $lmStudioConnected === true ? 'done' : $cloudApisAvailable ? 'skip' : $lmStudioConnected === false ? 'todo' : 'pending',
  );
  const stepModels = $derived(($models?.length ?? 0) > 0 ? 'done' : 'todo');
  const stepSelected = $derived(!!$effectiveModelId && ($models?.length ?? 0) > 0 ? 'done' : 'todo');

  const allReady = $derived(status === 'ready');

  async function onRetry() {
    refreshing = true;
    try {
      await refreshConnectionAndModels();
    } finally {
      refreshing = false;
    }
  }

  function openConnection() {
    settingsFocus.set('connection');
    settingsOpen.set(true);
  }

  function openApiKeys() {
    settingsFocus.set('api-keys');
    settingsOpen.set(true);
  }
</script>

{#if allReady}
  <div
    class="w-full rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"
    style="background: color-mix(in srgb, #22c55e 10%, var(--ui-bg-sidebar)); border: 1px solid color-mix(in srgb, #22c55e 28%, var(--ui-border));"
    role="status"
  >
    <span class="w-2 h-2 rounded-full shrink-0" style="background: #22c55e;" aria-hidden="true"></span>
    <span style="color: var(--ui-text-primary);">Ready to chat — pick a prompt below or type your question.</span>
  </div>
{:else}
  <div
    class="w-full rounded-xl px-4 py-4 text-sm"
    style="background: var(--ui-bg-sidebar); border: 1px solid var(--ui-border);"
    role="region"
    aria-label="Setup checklist"
  >
    <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
      <div>
        <p class="font-semibold" style="color: var(--ui-text-primary);">Get set up in under a minute</p>
        <p class="text-xs mt-0.5" style="color: var(--ui-text-secondary);">
          Local: <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer" style="color: var(--ui-accent);">LM Studio</a>
          on port 1234. Or use cloud models with an API key.
        </p>
      </div>
      <button
        type="button"
        class="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
        style="background: var(--ui-accent); color: var(--ui-bg-main);"
        disabled={refreshing || status === 'checking'}
        onclick={onRetry}
      >
        {refreshing || status === 'checking' ? 'Checking…' : 'Retry connection'}
      </button>
    </div>

    <ol class="space-y-2.5 list-none m-0 p-0">
      <li class="flex gap-2.5 items-start">
        <span
          class="setup-step-icon shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
          class:setup-step-done={stepLm === 'done'}
          class:setup-step-skip={stepLm === 'skip'}
          aria-hidden="true"
        >{stepLm === 'done' ? '✓' : stepLm === 'skip' ? '—' : '1'}</span>
        <div class="min-w-0 flex-1">
          <p class="font-medium text-xs" style="color: var(--ui-text-primary);">LM Studio server</p>
          <p class="text-[11px] mt-0.5" style="color: var(--ui-text-secondary);">
            {#if stepLm === 'done'}
              Connected on <code class="font-mono">localhost:1234</code> (or your custom URL).
            {:else if stepLm === 'skip'}
              Using cloud APIs — local server optional.
            {:else}
              Open LM Studio → Developer → start the local server, or
              <button type="button" class="underline" style="color: var(--ui-accent);" onclick={openApiKeys}>add a cloud API key</button>.
            {/if}
          </p>
        </div>
      </li>
      <li class="flex gap-2.5 items-start">
        <span
          class="setup-step-icon shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
          class:setup-step-done={stepModels === 'done'}
          aria-hidden="true"
        >{stepModels === 'done' ? '✓' : '2'}</span>
        <div class="min-w-0 flex-1">
          <p class="font-medium text-xs" style="color: var(--ui-text-primary);">Model available</p>
          <p class="text-[11px] mt-0.5" style="color: var(--ui-text-secondary);">
            {#if stepModels === 'done'}
              {$models.length} model{$models.length === 1 ? '' : 's'} found.
            {:else if $lmStudioConnected}
              In LM Studio, load a model into memory (Local Server tab).
            {:else}
              Load a model in LM Studio, or add DeepSeek / Grok / Cerebras keys in Settings.
            {/if}
          </p>
        </div>
      </li>
      <li class="flex gap-2.5 items-start">
        <span
          class="setup-step-icon shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
          class:setup-step-done={stepSelected === 'done'}
          aria-hidden="true"
        >{stepSelected === 'done' ? '✓' : '3'}</span>
        <div class="min-w-0 flex-1">
          <p class="font-medium text-xs" style="color: var(--ui-text-primary);">Model selected</p>
          <p class="text-[11px] mt-0.5" style="color: var(--ui-text-secondary);">
            {#if stepSelected === 'done'}
              Using the header model menu — you're good to send.
            {:else}
              Choose a model from the <strong>Model</strong> dropdown in the top bar.
            {/if}
          </p>
        </div>
      </li>
    </ol>

    <div class="flex flex-wrap gap-2 mt-3 pt-3" style="border-top: 1px solid var(--ui-border);">
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-90"
        style="border: 1px solid var(--ui-border); color: var(--ui-text-primary);"
        onclick={openConnection}
      >
        Connection settings
      </button>
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-90"
        style="border: 1px solid var(--ui-border); color: var(--ui-text-primary);"
        onclick={openApiKeys}
      >
        API keys
      </button>
    </div>
  </div>
{/if}

<style>
  .setup-step-icon {
    background: color-mix(in srgb, var(--ui-border) 50%, transparent);
    color: var(--ui-text-secondary);
  }
  .setup-step-icon.setup-step-done {
    background: color-mix(in srgb, #22c55e 20%, transparent);
    color: #22c55e;
  }
  .setup-step-icon.setup-step-skip {
    background: color-mix(in srgb, #3b82f6 15%, transparent);
    color: #3b82f6;
  }
</style>