<script>
  import { uiTheme } from '$lib/stores.js';
  import { UI_THEME_OPTIONS } from '$lib/themeOptions.js';
  import ThemePickerModal from '$lib/components/ThemePickerModal.svelte';

  /** When true, use a compact select (smaller padding, shorter label). */
  let { compact = false } = $props();
  let pickerOpen = $state(false);

  const currentLabel = $derived(UI_THEME_OPTIONS.find((o) => o.value === $uiTheme)?.label ?? $uiTheme);
</script>

<button
  type="button"
  class="ui-theme-btn rounded-lg px-2 text-xs font-semibold cursor-pointer border transition-colors focus:outline-none focus:ring-1 truncate inline-flex items-center gap-1.5 {compact ? 'py-1.5' : 'py-2'}"
  style="background: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border); min-width: {compact ? '6rem' : '8rem'}; letter-spacing: 0.02em; text-transform: none;"
  title="UI color theme"
  aria-label="UI color theme"
  onclick={() => (pickerOpen = true)}>
  <span class="ui-theme-swatch" style="background: {currentLabel === 'Forge' ? '#f59e0b' : currentLabel === 'Sage' ? '#6b7280' : currentLabel === 'Obsidian' ? '#1e293b' : currentLabel === 'Nova' ? '#3b82f6' : '#10a37f'};"></span>
  {currentLabel}
</button>

<ThemePickerModal bind:open={pickerOpen} />

<style>
  .ui-theme-swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }
</style>
