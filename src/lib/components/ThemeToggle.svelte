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
  class="px-2.5 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-colors border"
  style="color: var(--ui-text-secondary); border-color: var(--ui-border); background: color-mix(in srgb, var(--ui-input-bg) 70%, transparent);"
  onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--ui-accent) 14%, transparent)')}
  onmouseleave={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--ui-input-bg) 70%, transparent)')}
  onclick={cycle}
  title="Theme: {label}">
  {label}
</button>
