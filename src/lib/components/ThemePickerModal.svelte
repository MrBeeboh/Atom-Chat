<script>
  import { uiTheme } from '$lib/stores.js';
  import { UI_THEME_OPTIONS } from '$lib/themeOptions.js';
  import { fade, scale } from 'svelte/transition';

  let { open = $bindable(false) } = $props();

  function selectTheme(value) {
    uiTheme.set(value);
    open = false;
  }

  /** Preview colors for theme swatches (bg + accent). */
  const PREVIEW = {
    lavender: { bg: '#f8f6fc', accent: '#8b7ab8', text: '#1e1b2e' },
    sage:     { bg: '#f6f5f2', accent: '#6b7c5a', text: '#2d2a26' },
    obsidian: { bg: '#16181d', accent: '#5eead4', text: '#e2e8f0' },
  };
</script>

{#if open}
  <div
    class="fixed inset-0 z-[110] flex items-center justify-center p-4"
    role="dialog"
    aria-label="Choose theme"
    tabindex="-1"
    transition:fade={{ duration: 150 }}
    onkeydown={(e) => e.key === 'Escape' && (open = false)}
    onclick={() => (open = false)}>
    <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true"></div>
    <div
      class="relative z-10 w-full max-w-2xl max-h-[80vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col"
      style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);"
      role="presentation"
      transition:scale={{ start: 0.96, duration: 200 }}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}>
      <div class="shrink-0 flex items-center justify-between px-5 py-3 border-b" style="border-color: var(--ui-border);">
        <h2 class="text-sm font-semibold" style="color: var(--ui-text-primary);">Choose Theme</h2>
        <button type="button" class="p-1 rounded text-xs" style="color: var(--ui-text-secondary);" onclick={() => (open = false)} aria-label="Close">✕</button>
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));">
          {#each UI_THEME_OPTIONS as t}
            {@const p = PREVIEW[t.value] || { bg: '#888', accent: '#fff', text: '#000' }}
            {@const active = $uiTheme === t.value}
            <button
              type="button"
              class="group rounded-xl border-2 overflow-hidden transition-all duration-150 text-left {active ? 'ring-2 ring-offset-1' : 'hover:scale-[1.03]'}"
              style="border-color: {active ? 'var(--ui-accent)' : 'var(--ui-border)'}; --tw-ring-color: var(--ui-accent);"
              onclick={() => selectTheme(t.value)}>
              <div class="h-14 relative" style="background: {p.bg};">
                <div class="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
                  <div class="w-5 h-5 rounded-md shadow-sm" style="background: {p.accent};"></div>
                  <div class="flex-1 h-1.5 rounded-full opacity-40" style="background: {p.text};"></div>
                </div>
              </div>
              <div class="px-2.5 py-2" style="background: var(--ui-bg-main);">
                <span class="text-[11px] font-medium leading-tight block truncate" style="color: var(--ui-text-primary);">{t.label}</span>
              </div>
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}
