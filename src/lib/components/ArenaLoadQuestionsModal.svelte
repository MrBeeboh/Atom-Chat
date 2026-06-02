<script>
  let {
    open = $bindable(false),
    buildArenaInProgress = false,
    manualImportText = $bindable(''),
    manualImportError = '',
    onApplyImport = () => {},
    onBuildArena = () => {},
    onOpenSettings = () => {},
  } = $props();

  const EXAMPLE = `[
  { "question": "What is the speed of light in vacuum?", "answer": "299792458 m/s" },
  { "question": "Name three sorting algorithms and their typical time complexity." }
]`;

  function useExample() {
    manualImportText = EXAMPLE;
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center p-4"
    style="background: rgba(0,0,0,0.45);"
    role="dialog"
    aria-modal="true"
    aria-labelledby="arena-load-title"
  >
    <div
      class="rounded-xl p-5 sm:p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto flex flex-col gap-4"
      style="background: var(--ui-bg-main); border: 1px solid var(--ui-border);"
    >
      <div>
        <h2 id="arena-load-title" class="text-lg font-bold" style="color: var(--ui-text-primary);">Load questions</h2>
        <p class="text-xs mt-1" style="color: var(--ui-text-secondary);">
          Paste JSON, or plain text with numbered Q&amp;A. You can also generate a set with the judge model.
        </p>
      </div>

      <div>
        <div class="flex items-center justify-between gap-2 mb-1">
          <label for="arena-import-text" class="text-xs font-medium" style="color: var(--ui-text-secondary);">Question set</label>
          <button
            type="button"
            class="text-[11px] font-medium underline"
            style="color: var(--ui-accent);"
            onclick={useExample}
          >Insert example</button>
        </div>
        <textarea
          id="arena-import-text"
          bind:value={manualImportText}
          rows="10"
          class="w-full rounded-lg px-3 py-2 text-xs font-mono resize-y"
          style="border: 1px solid var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary); min-height: 140px;"
          placeholder="JSON array or Questions:/Answers: blocks…"
        ></textarea>
        {#if manualImportError}
          <p class="text-xs mt-2 font-medium" role="alert" style="color: var(--ui-accent-hot, #dc2626);">{manualImportError}</p>
        {/if}
      </div>

      <div class="flex flex-col sm:flex-row flex-wrap gap-2 pt-1">
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-semibold"
          style="background: var(--ui-accent); color: var(--ui-bg-main);"
          onclick={onApplyImport}
        >Apply import</button>
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          style="border: 1px solid var(--ui-border); color: var(--ui-text-primary);"
          disabled={buildArenaInProgress}
          onclick={() => { open = false; onBuildArena(); }}
        >{buildArenaInProgress ? 'Building…' : 'Build with AI instead'}</button>
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-medium"
          style="color: var(--ui-text-secondary);"
          onclick={() => { open = false; onOpenSettings(); }}
        >Builder settings</button>
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-medium sm:ml-auto"
          style="color: var(--ui-text-secondary);"
          onclick={() => (open = false)}
        >Cancel</button>
      </div>
    </div>
  </div>
{/if}