<script>
  import { theme } from '$lib/stores.js';

  function cycle() {
    theme.update((t) => {
      if (t === 'system') return 'light';
      if (t === 'light') return 'dark';
      return 'system';
    });
  }

  $: label = $theme === 'dark' ? 'Dark' : $theme === 'light' ? 'Light' : 'Auto';
</script>

<button
  type="button"
  class="p-2 rounded-xl text-sm font-medium transition-colors"
  style="color: var(--ui-text-secondary);"
  onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--ui-border) 40%, transparent)')}
  onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
  onclick={cycle}
  title="Theme: {label}">
  {label}
</button>
