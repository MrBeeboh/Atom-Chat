<script>
  let {
    open = $bindable(false),
    buildArenaInProgress = false,
    buildArenaError = '',
    lastFailedBuildRaw = '',
    manualImportText = $bindable(''),
    manualImportError = '',
    onBuildArena = () => {},
    onApplyImport = () => {},
    onRepairJson = () => {},
    onOpenSettings = () => {},
  } = $props();
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.5);">
    <div class="rounded-xl p-6 max-w-lg w-full" style="background: var(--ui-bg-main); border: 1px solid var(--ui-border);">
      <h2 class="text-lg font-bold mb-4" style="color: var(--ui-text-primary);">Load Questions</h2>
      <p style="color: var(--ui-text-secondary);">Use the Build button in the toolbar to generate questions.</p>
      <button class="mt-4 px-4 py-2 rounded-lg" style="background: var(--ui-accent); color: var(--ui-bg-main);" onclick={() => open = false}>Close</button>
    </div>
  </div>
{/if}
