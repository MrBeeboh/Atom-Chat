<script>
  import { theme } from '$lib/stores.js';

  function cycle() {
    theme.update((t) => {
      if (t === 'system') return 'light';
      if (t === 'light') return 'dark';
      return 'system';
    });
  }

  $: label =
    $theme === 'dark' ? 'Dark mode' : $theme === 'light' ? 'Light mode' : 'Match system appearance';
</script>

<button
  type="button"
  class="theme-icon-toggle flex items-center justify-center w-10 h-10 rounded-xl shrink-0 transition-colors"
  style="color: var(--ui-text-secondary); background: transparent;"
  class:theme-icon-toggle-active={$theme !== 'system'}
  onclick={cycle}
  title="Color scheme: {label}. Click to cycle system → light → dark."
  aria-label="Color scheme: {label}. Click to cycle."
>
  {#if $theme === 'dark'}
    <!-- Moon -->
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  {:else if $theme === 'light'}
    <!-- Sun -->
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  {:else}
    <!-- System / auto -->
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  {/if}
</button>

<style>
  .theme-icon-toggle:hover {
    background: color-mix(in srgb, var(--ui-border) 35%, transparent);
    color: var(--ui-text-primary);
  }
  .theme-icon-toggle-active {
    color: var(--ui-accent);
  }
</style>
