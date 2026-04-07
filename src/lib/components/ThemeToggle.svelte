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
  class="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-700/80 text-zinc-600 dark:text-zinc-400 text-sm font-medium transition-colors"
  onclick={cycle}
  title="Theme: {label}">
  {label}
</button>
