<script>
  import { fade } from 'svelte/transition';
  import { shortcutsModalOpen } from '$lib/stores.js';

  const SHORTCUTS = [
    { label: 'Command palette', keys: 'Ctrl+K' },
    { label: 'Command palette (alt)', keys: '/' },
    { label: 'New chat', keys: 'Ctrl+N' },
    { label: 'Export chat', keys: 'Ctrl+Shift+E' },
    { label: 'Clear chat', keys: 'Ctrl+Shift+L' },
    { label: 'Send message', keys: 'Ctrl+Enter' },
    { label: 'Convo rail expand/collapse', keys: '[' },
    { label: 'Intel panel toggle', keys: ']' },
  ];

  function close() {
    shortcutsModalOpen.set(false);
  }
</script>

{#if $shortcutsModalOpen}
  <div
    class="fixed inset-0 z-[150] flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Keyboard shortcuts"
    transition:fade={{ duration: 150 }}
  >
    <div class="absolute inset-0 bg-black/50" onclick={close}></div>
    <div
      class="relative rounded-xl border shadow-xl max-w-sm w-full p-4"
      style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-semibold" style="color: var(--ui-text-primary);">Keyboard shortcuts</h2>
        <button
          type="button"
          class="p-1.5 rounded text-sm hover:opacity-80"
          style="color: var(--ui-text-secondary);"
          onclick={close}
          aria-label="Close"
        >✕</button>
      </div>
      <div class="space-y-2">
        {#each SHORTCUTS as s}
          <div class="flex items-center justify-between gap-4 text-sm">
            <span style="color: var(--ui-text-secondary);">{s.label}</span>
            <kbd class="px-2 py-0.5 rounded text-xs font-mono border" style="background-color: var(--ui-input-bg); border-color: var(--ui-border); color: var(--ui-text-primary);">{s.keys}</kbd>
          </div>
        {/each}
      </div>
      <p class="mt-4 text-xs" style="color: var(--ui-text-secondary);">Tip: Press <kbd class="px-1 rounded text-[10px] font-mono" style="background-color: var(--ui-input-bg); border: 1px solid var(--ui-border);">?</kbd> anytime to show this.</p>
    </div>
  </div>
{/if}
