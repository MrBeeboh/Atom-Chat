<script>
  import { uiTheme } from '$lib/stores.js';
  import { UI_THEME_OPTIONS } from '$lib/themeOptions.js';
  import { fade, scale } from 'svelte/transition';

  let { open = $bindable(false) } = $props();

  function selectTheme(value) {
    uiTheme.set(value);
    open = false;
  }

  /** Preview colors extracted from app.css theme definitions. bg + accent for swatch. */
  const PREVIEW = {
    atom:             { bg: '#0c0c0c', accent: '#00d4aa', text: '#f5f5f5' },
    default:          { bg: '#fafafa', accent: '#B22234', text: '#18181b' },
    cyberpunk:        { bg: '#0a0e27', accent: '#00ff9f', text: '#e6e6e6' },
    neural:           { bg: '#0b0c10', accent: '#66fcf1', text: '#c5c6c7' },
    quantum:          { bg: '#0d0221', accent: '#f72585', text: '#f0f0f0' },
    arctic:           { bg: '#f8fafc', accent: '#f97316', text: '#0f172a' },
    neon:             { bg: '#ffffff', accent: '#eab308', text: '#171717' },
    mint:             { bg: '#f0fdf4', accent: '#10b981', text: '#064e3b' },
    coral:            { bg: '#fffbeb', accent: '#f97316', text: '#1c1917' },
    highcontrast:     { bg: '#ffffff', accent: '#2563eb', text: '#000000' },
    cybercitrus:      { bg: '#fefce8', accent: '#65a30d', text: '#14532d' },
    industrialhazard: { bg: '#ffffff', accent: '#facc15', text: '#000000' },
    fireice:          { bg: '#0c4a6e', accent: '#ff6b35', text: '#f0f9ff' },
    hacker:           { bg: '#001a00', accent: '#00ff41', text: '#33ff77' },
    medical:          { bg: '#f8f9fa', accent: '#0077b6', text: '#212529' },
    radioactivelab:   { bg: '#0a0a0a', accent: '#ccff00', text: '#ffffff' },
    coppercircuit:    { bg: '#1a1410', accent: '#ff6b35', text: '#fef5e7' },
    arcticneon:       { bg: '#e8f4f8', accent: '#00d9ff', text: '#001a1f' },
    sunsetgradient:   { bg: '#fff5f5', accent: '#ff6b35', text: '#2d1b1e' },
    racingstripe:     { bg: '#ffffff', accent: '#e30613', text: '#000000' },
    jungleterminal:   { bg: '#f0f4f0', accent: '#2d5016', text: '#1a1a1a' },
    magmaflow:        { bg: '#1a0a00', accent: '#ff4500', text: '#fff5ee' },
    chromeglass:      { bg: '#f8f9fa', accent: '#0066cc', text: '#212529' },
    toxicwaste:       { bg: '#000000', accent: '#ffff00', text: '#ffff00' },
    oceandeep:        { bg: '#001529', accent: '#1890ff', text: '#e6f7ff' },
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
