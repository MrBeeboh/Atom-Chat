<script>
  import { onMount, tick } from 'svelte';

  import { get } from 'svelte/store';
  import { fly } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import { theme, sidebarOpen, settingsOpen, layout, dashboardModelA, dashboardModelB, dashboardModelC, dashboardModelD, activeConversationId, conversations, selectedModelId, uiTheme, sidebarCollapsed, cockpitIntelOpen, arenaPanelCount, models, lmStudioConnected, cloudApisAvailable } from '$lib/stores.js';
  import { createConversation, listConversations, getMessageCount, getMessages } from '$lib/db.js';
  import { getModels } from '$lib/api.js';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import ChatView from '$lib/components/ChatView.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import UiThemeSelect from '$lib/components/UiThemeSelect.svelte';
  import PresetSelect from '$lib/components/PresetSelect.svelte';
  import ModelSelector from '$lib/components/ModelSelector.svelte';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import AudioManager from '$lib/components/AudioManager.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import ConvoRail from '$lib/components/ConvoRail.svelte';
  import IntelPanel from '$lib/components/IntelPanel.svelte';
  import DashboardArena from '$lib/components/DashboardArena.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import AtomLogo from '$lib/components/AtomLogo.svelte';
  import { checkLmStudioConnection } from '$lib/api.js';
  import { COCKPIT_LM_CHECKING, COCKPIT_LM_CONNECTED, COCKPIT_LM_UNREACHABLE, COCKPIT_CLOUD_APIS_AVAILABLE, pickWitty } from '$lib/cockpitCopy.js';

  const LAYOUT_OPTS = [
    { value: 'cockpit', label: 'Cockpit' },
    { value: 'arena', label: 'Arena' },
  ];
  // Ensure layout is always cockpit or arena (guard against bad storage)
  $effect(() => {
    const v = $layout;
    if (v !== 'cockpit' && v !== 'arena') layout.set('cockpit');
  });
  const HEADER_PRESET_MIN = 'min-width: 7rem;';

  /** Witty LM Studio / cloud status line; updates when connection state changes. */
  let lmStatusMessage = $state('');
  $effect(() => {
    const c = $lmStudioConnected;
    const cloud = $cloudApisAvailable;
    if (c === true) lmStatusMessage = pickWitty(COCKPIT_LM_CONNECTED);
    else if (c === false && cloud) lmStatusMessage = pickWitty(COCKPIT_CLOUD_APIS_AVAILABLE);
    else if (c === false) lmStatusMessage = pickWitty(COCKPIT_LM_UNREACHABLE);
    else lmStatusMessage = pickWitty(COCKPIT_LM_CHECKING);
  });

  onMount(() => {
    function applyTheme(want) {
      const t = want ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('theme') : null) ?? 'system';
      const isDark = t === 'dark' || (t === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', isDark);
    }
    applyTheme(get(theme));
    const unsub = theme.subscribe((v) => applyTheme(v));
    const mq = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', () => applyTheme());
    return () => {
      unsub();
      mq?.removeEventListener?.('change', () => applyTheme());
    };
  });
  theme.subscribe((v) => { if (typeof localStorage !== 'undefined') localStorage.setItem('theme', v); });
  uiTheme.subscribe((v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('uiTheme', v);
    if (typeof document !== 'undefined') document.documentElement.dataset.uiTheme = v;
  });
  layout.subscribe((v) => { if (typeof localStorage !== 'undefined') localStorage.setItem('layout', v); });
  sidebarCollapsed.subscribe((v) => { if (typeof localStorage !== 'undefined') localStorage.setItem('sidebarCollapsed', v ? 'true' : 'false'); });
  onMount(() => { document.documentElement.dataset.uiTheme = get(uiTheme); });

  onMount(() => {
    let pollId;
    const POLL_MS = 30000; // 30s when visible – avoid pinging LM Studio too often so idle unload can run
    const POLL_MS_HIDDEN = 60000; // 60s when tab hidden
    async function pollConnection() {
      lmStudioConnected.set(await checkLmStudioConnection());
      const interval = typeof document !== 'undefined' && document.visibilityState === 'hidden' ? POLL_MS_HIDDEN : POLL_MS;
      pollId = setTimeout(pollConnection, interval);
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        clearTimeout(pollId);
        pollConnection();
      }
    }
    pollConnection();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimeout(pollId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

  onMount(async () => {
    let list = await listConversations();
    if (list.length === 0) {
      const id = await createConversation();
      activeConversationId.set(id);
      list = await listConversations();
    }
    list = await Promise.all(list.map(async (c) => ({ ...c, messageCount: await getMessageCount(c.id) })));
    conversations.set(list);
    if (!get(activeConversationId) && list.length > 0) activeConversationId.set(list[0].id);

    try {
      const modelList = await getModels();
      models.set(modelList.map((m) => ({ id: m.id })));
    } catch (_) {
      // LM Studio may not be running; selectors will refetch when opened
    }
  });

  async function refreshConversations() {
    let list = await listConversations();
    list = await Promise.all(list.map(async (c) => ({ ...c, messageCount: await getMessageCount(c.id) })));
    conversations.set(list);
  }

  async function newChat() {
    const id = await createConversation();
    await refreshConversations();
    activeConversationId.set(id);
  }

  let intelTabBounce = $state(false);
  function toggleIntel() {
    cockpitIntelOpen.update((v) => !v);
    intelTabBounce = true;
    setTimeout(() => (intelTabBounce = false), 420);
  }

  let sidebarTabBounce = $state(false);
  function toggleSidebarCollapsed() {
    sidebarCollapsed.update((v) => !v);
    sidebarTabBounce = true;
    setTimeout(() => (sidebarTabBounce = false), 420);
  }
</script>

<div class="h-screen overflow-hidden" style="background-color: var(--ui-bg-main);">

  <AudioManager />
  <CommandPalette />
  <ConfirmModal />
  <ShortcutsModal />

  {#if $layout === 'cockpit'}
    <div class="flex h-full flex-col">
      <!-- Cockpit header: 3-zone layout — left (brand+layout), center (model+preset), right (theme+status) -->
      <header class="cockpit-header shrink-0 flex items-center px-4 py-2.5" style="background-color: var(--ui-bg-sidebar);">
        <!-- Left: brand + layout pill -->
        <div class="flex items-center gap-3 shrink-0" role="group" aria-label="Brand and layout">
          <span class="cockpit-brand flex items-center gap-1.5 shrink-0 text-lg font-bold" style="color: var(--ui-accent);"><AtomLogo size={22} />ATOM</span>
          <nav class="layout-pill flex rounded-full p-0.5 shrink-0 text-xs font-medium" style="background: color-mix(in srgb, var(--ui-border) 60%, transparent);" aria-label="Layout: Cockpit or Arena">
            {#each LAYOUT_OPTS as opt}
              <button type="button" class="layout-pill-btn rounded-full px-3 py-1.5 transition-all" style="background: {$layout === opt.value ? 'var(--ui-accent)' : 'transparent'}; color: {$layout === opt.value ? 'var(--ui-bg-main)' : 'var(--ui-text-secondary)'};" onclick={() => layout.set(opt.value)}>{opt.label}</button>
            {/each}
          </nav>
        </div>
        <!-- Center: model selector + preset -->
        <div class="flex-1 flex items-center justify-center gap-2 sm:gap-3 min-w-0 px-2 sm:px-4" role="group" aria-label="Model and preset">
          <span class="text-xs font-semibold uppercase tracking-wider shrink-0 hidden sm:inline" style="color: var(--ui-text-secondary);">Model</span>
          <div class="min-w-0 flex-1 flex justify-center max-w-full">
            <div class="min-w-0 w-full max-w-[min(15rem,56vw)] sm:max-w-[min(18rem,48vw)] md:max-w-[min(20rem,42vw)] lg:max-w-[min(22rem,36vw)]">
              <ModelSelector compact={true} />
            </div>
          </div>
          <div class="shrink-0" style="{HEADER_PRESET_MIN}"><PresetSelect compact={true} /></div>
        </div>
        <!-- Right: theme + status -->
        <div class="flex items-center gap-3 shrink-0" role="group" aria-label="Appearance and status">
          <div class="flex items-center gap-2 shrink-0" role="group" aria-label="UI palette and color scheme">
            <UiThemeSelect compact={true} />
            <span class="w-px h-7 shrink-0 self-center opacity-70" style="background: var(--ui-border);" aria-hidden="true"></span>
            <ThemeToggle />
          </div>
          <span class="flex items-center gap-1.5 shrink-0 text-xs font-medium" style="color: var(--ui-text-primary);" title={lmStatusMessage} aria-label={lmStatusMessage}>
            <span class="w-2 h-2 rounded-full shrink-0" style="background-color: {$lmStudioConnected === true ? '#22c55e' : $lmStudioConnected === false ? ($cloudApisAvailable ? '#3b82f6' : '#ef4444') : '#94a3b8'};" aria-hidden="true"></span>
            <span class="hidden sm:inline">{lmStatusMessage}</span>
          </span>
        </div>
      </header>
      <div class="flex flex-1 min-h-0 min-w-0 relative gap-0">
        <ConvoRail />
        <main class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" style="background-color: var(--ui-bg-main);">
          <ChatView />
        </main>
        {#if $cockpitIntelOpen}
          <aside
            class="w-[280px] shrink-0 overflow-visible flex flex-col relative"
            style="background-color: var(--ui-bg-sidebar);"
            in:fly={{ x: 280, duration: 400, easing: backOut }}
            out:fly={{ x: 280, duration: 300, easing: quintOut }}
          >
            <button
              type="button"
              class="panel-tab {intelTabBounce ? 'panel-tab-bounce' : ''}"
              style="--panel-tab-transform: translate(-100%, -50%); left: 0; top: 50%;"
              title="Close Intel panel"
              aria-label="Close Intel panel"
              onclick={toggleIntel}
            >
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
            </button>
            <div class="flex-1 overflow-hidden flex flex-col min-h-0 pl-6">
              <IntelPanel />
            </div>
          </aside>
        {:else}
          <!-- Visible strip so the open tab is never clipped (root has overflow-hidden) -->
          <div class="intel-tab-strip shrink-0 w-7 flex items-center justify-center relative min-h-0" style="background-color: var(--ui-bg-sidebar);">
            <button
              type="button"
              class="panel-tab {intelTabBounce ? 'panel-tab-bounce' : ''}"
              style="--panel-tab-transform: translateY(-50%); left: 0; top: 50%;"
              title="Open Intel panel"
              aria-label="Open Intel panel"
              onclick={toggleIntel}
            >
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
            </button>
          </div>
        {/if}
      </div>
    </div>

  {:else if $layout === 'arena'}
    <div class="flex h-full flex-col">
      <header
        class="arena-shell-header shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 text-sm border-b"
        style="background: var(--ui-bg-sidebar); border-color: color-mix(in srgb, var(--ui-border) 85%, transparent); color: var(--ui-text-secondary);"
      >
        <!-- Brand + layout -->
        <div class="flex items-center gap-2 sm:gap-3 shrink-0" role="group" aria-label="Brand and layout">
          <button
            type="button"
            class="md:hidden flex items-center justify-center rounded-lg min-h-[44px] min-w-[44px] transition-colors hover:opacity-85"
            style="color: var(--ui-text-secondary); background: color-mix(in srgb, var(--ui-border) 35%, transparent);"
            onclick={() => sidebarOpen.set(true)}
            aria-label="Open menu"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span class="flex items-center gap-1.5 text-base sm:text-lg font-bold tracking-tight shrink-0" style="color: var(--ui-accent);">
            <AtomLogo size={22} />ATOM Arena
          </span>
          <nav
            class="layout-pill flex rounded-full p-0.5 shrink-0 text-[11px] sm:text-xs font-semibold shadow-sm"
            style="background: color-mix(in srgb, var(--ui-border) 55%, transparent); box-shadow: inset 0 1px 0 color-mix(in srgb, white 6%, transparent);"
            aria-label="Layout: Cockpit or Arena"
          >
            {#each LAYOUT_OPTS as opt}
              <button
                type="button"
                class="layout-pill-btn rounded-full px-2.5 sm:px-3 py-1.5 transition-all duration-150"
                style="background: {$layout === opt.value ? 'var(--ui-accent)' : 'transparent'}; color: {$layout === opt.value ? 'var(--ui-bg-main)' : 'var(--ui-text-secondary)'}; box-shadow: {$layout === opt.value ? '0 1px 2px color-mix(in srgb, black 12%, transparent)' : 'none'};"
                onclick={() => layout.set(opt.value)}
              >{opt.label}</button>
            {/each}
          </nav>
        </div>

        <span class="hidden sm:block w-px h-7 shrink-0 opacity-60" style="background: var(--ui-border);" aria-hidden="true"></span>

        <!-- Panel count -->
        <div class="flex items-center gap-2 shrink-0" role="group" aria-label="Arena panels">
          <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--ui-text-secondary); opacity: 0.85;" title="Keyboard: Alt+1–4">Panels</span>
          <div class="flex rounded-lg p-0.5 gap-0.5" style="background: color-mix(in srgb, var(--ui-border) 40%, transparent);" role="group" aria-label="Arena panel count">
            {#each [1, 2, 3, 4] as n}
              <button
                type="button"
                class="min-w-[2rem] h-7 rounded-md text-xs font-bold transition-all duration-150 {$arenaPanelCount === n ? 'shadow-sm' : 'opacity-55 hover:opacity-90'}"
                style="{$arenaPanelCount === n ? 'background: var(--ui-accent); color: var(--ui-bg-main);' : 'color: var(--ui-text-secondary); background: transparent;'}"
                onclick={() => arenaPanelCount.set(n)}
                aria-label="{n} panel{n === 1 ? '' : 's'} (Alt+{n})"
                aria-pressed={$arenaPanelCount === n}
                title="{n} panel{n === 1 ? '' : 's'} — Alt+{n}"
              >{n}</button>
            {/each}
          </div>
        </div>

        <!-- Preset + theme + toggle: inline on large screens -->
        <div class="hidden lg:flex items-center gap-2 shrink-0 pl-1" role="group" aria-label="Preset and appearance">
          <span class="w-px h-7 shrink-0 opacity-60" style="background: var(--ui-border);" aria-hidden="true"></span>
          <div style="{HEADER_PRESET_MIN}" title="Global system prompt preset. Slots can override in Options.">
            <PresetSelect compact={true} />
          </div>
          <UiThemeSelect compact={true} />
          <span class="w-px h-7 shrink-0 opacity-60" style="background: var(--ui-border);" aria-hidden="true"></span>
          <ThemeToggle />
        </div>

        <!-- Collapsed appearance on smaller screens -->
        <details class="lg:hidden group shrink-0 rounded-lg border open:pb-2 open:px-2 open:pt-1" style="border-color: color-mix(in srgb, var(--ui-border) 70%, transparent); background: color-mix(in srgb, var(--ui-border) 12%, transparent);">
          <summary class="cursor-pointer select-none list-none flex items-center gap-1.5 py-1.5 px-2 text-[11px] font-bold uppercase tracking-wide [&::-webkit-details-marker]:hidden" style="color: var(--ui-text-secondary);">
            Look & preset
            <svg class="w-3.5 h-3.5 transition-transform group-open:rotate-180 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div class="flex flex-wrap items-center gap-2 pt-1 pb-0.5" role="group" aria-label="Preset and appearance">
            <div style="{HEADER_PRESET_MIN}"><PresetSelect compact={true} /></div>
            <UiThemeSelect compact={true} />
            <ThemeToggle />
          </div>
        </details>

        <div class="flex-1 min-w-[1rem]" aria-hidden="true"></div>

        <!-- Connection status (same semantics as Cockpit: cloud fallback when LM down) -->
        <div class="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end sm:justify-start" role="status" aria-label={lmStatusMessage}>
          <span
            class="flex items-center gap-2 shrink-0 text-xs font-medium px-2 py-1 rounded-lg max-w-[min(100%,20rem)]"
            style="color: var(--ui-text-primary); background: color-mix(in srgb, var(--ui-border) 25%, transparent);"
            title={lmStatusMessage}
          >
            <span
              class="w-2 h-2 rounded-full shrink-0"
              style="background-color: {$lmStudioConnected === true ? '#22c55e' : $lmStudioConnected === false ? ($cloudApisAvailable ? '#3b82f6' : '#ef4444') : '#94a3b8'}; box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-bg-sidebar) 70%, transparent);"
              aria-hidden="true"
            ></span>
            <span class="truncate">{lmStatusMessage}</span>
          </span>
        </div>
      </header>
      <div class="flex flex-1 min-h-0 relative">
        <aside
          class="shrink-0 overflow-hidden hidden md:flex flex-col transition-[width] duration-200 relative min-w-0 {$layout === 'arena' ? 'arena-sidebar-secondary' : ''}"
          style="width: {$sidebarCollapsed ? '52px' : '13rem'}; background-color: var(--ui-bg-sidebar);">
          {#if $sidebarCollapsed}
            <div class="panel-tab-strip-icon-wrap pr-1" aria-hidden="true">
              <span class="panel-tab-strip-icon" title="Conversations">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </span>
            </div>
          {/if}
          <button
            type="button"
            class="panel-tab {sidebarTabBounce ? 'panel-tab-bounce' : ''}"
            style="--panel-tab-transform: translate(100%, -50%); top: 50%; right: 0;"
            title={$sidebarCollapsed ? 'Expand sidebar (conversations)' : 'Collapse sidebar'}
            aria-label={$sidebarCollapsed ? 'Expand sidebar (conversations)' : 'Collapse sidebar'}
            onclick={toggleSidebarCollapsed}>
            {#if $sidebarCollapsed}
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
            {:else}
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
            {/if}
          </button>
          <div class="min-h-0 overflow-auto {$sidebarCollapsed ? 'w-0 min-w-0 max-w-0 flex-[0_0_0] overflow-hidden' : 'flex-1 min-w-0'}">
            <Sidebar />
          </div>
        </aside>
        {#if $sidebarOpen}
          <div class="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Sidebar">
            <div class="absolute inset-0 bg-black/40" role="button" tabindex="0" aria-label="Close sidebar" onclick={() => sidebarOpen.set(false)} onkeydown={(e) => e.key === 'Enter' || e.key === ' ' ? (e.preventDefault(), sidebarOpen.set(false)) : null}></div>
            <aside class="absolute left-0 top-0 bottom-0 w-64 shadow-xl rounded-r-xl overflow-hidden" style="background-color: var(--ui-bg-sidebar);"><Sidebar /></aside>
          </div>
        {/if}
        <div class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" style="background-color: var(--ui-bg-main);">
          <DashboardArena />
        </div>
      </div>
    </div>

  {/if}

  {#if $settingsOpen}
    <SettingsPanel onclose={() => settingsOpen.set(false)} />
  {/if}
</div>
