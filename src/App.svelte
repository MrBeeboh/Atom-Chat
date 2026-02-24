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
  const HEADER_MODEL_MIN = 'min-width: 22rem;';
  const HEADER_PRESET_MIN = 'min-width: 7rem;';
  const HEADER_THEME_MIN = 'min-width: 10rem;';
  const HEADER_GROUP_GAP = 'gap: 0.75rem;';
  const HEADER_BETWEEN_GROUPS = '1.25rem';
  const HEADER_RIGHT_GROUP = 'margin-left: auto;';

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
        <!-- Left: brand + layout toggle -->
        <div class="flex items-center gap-2 shrink-0" role="group" aria-label="Brand and layout">
          <span class="flex items-center gap-1.5 font-semibold shrink-0" style="color: var(--ui-accent);"><AtomLogo size={20} />ATOM</span>
          <span class="text-xs font-medium shrink-0" style="color: var(--ui-text-secondary);">Mode:</span>
          <nav class="flex items-center gap-0.5 shrink-0" aria-label="Layout: Cockpit or Arena">
            {#each LAYOUT_OPTS as opt}
              <button type="button" class="h-7 px-2.5 rounded-md text-xs font-medium shrink-0 transition-opacity hover:opacity-90" style="background: {$layout === opt.value ? 'color-mix(in srgb, var(--ui-accent) 12%, transparent)' : 'transparent'}; color: {$layout === opt.value ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'};" onclick={() => layout.set(opt.value)}>{opt.label}</button>
            {/each}
          </nav>
        </div>
        <!-- Center: model selector + preset -->
        <div class="flex-1 flex items-center justify-center gap-3 min-w-0 px-4" role="group" aria-label="Model and preset">
          <span class="text-xs font-semibold uppercase tracking-wider shrink-0" style="color: var(--ui-text-secondary);">Model</span>
          <div class="min-w-0" style="{HEADER_MODEL_MIN}"><ModelSelector /></div>
          <div class="shrink-0" style="{HEADER_PRESET_MIN}"><PresetSelect compact={true} /></div>
        </div>
        <!-- Right: theme + status -->
        <div class="flex items-center gap-4 shrink-0" role="group" aria-label="Appearance and status">
          <div class="flex items-center gap-2 shrink-0" style="min-width: 8.5rem;">
            <UiThemeSelect compact={true} />
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
      <header class="shrink-0 flex items-center flex-wrap px-3 py-2 text-sm" style="background: var(--ui-bg-sidebar); color: var(--ui-text-secondary); gap: {HEADER_BETWEEN_GROUPS};">
        <div class="flex items-center shrink-0" style="{HEADER_GROUP_GAP}" role="group" aria-label="Brand and layout">
          <button type="button" class="md:hidden p-2 rounded-md min-h-[44px] min-w-[44px] flex items-center justify-center transition-opacity hover:opacity-80" style="color: var(--ui-text-secondary);" onclick={() => sidebarOpen.set(true)} aria-label="Open menu">☰</button>
          <span class="flex items-center gap-1.5 font-semibold shrink-0" style="color: var(--ui-accent);"><AtomLogo size={20} />ATOM Arena</span>
          <span class="text-[11px] font-medium shrink-0" style="color: var(--ui-text-secondary);">Mode</span>
          <nav class="flex items-center gap-0.5 shrink-0" aria-label="Layout: Cockpit or Arena">
            {#each LAYOUT_OPTS as opt}
              <button type="button" class="px-2.5 py-1 rounded-md text-xs {$layout === opt.value ? 'font-medium' : ''}" style="color: {$layout === opt.value ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'}; background: {$layout === opt.value ? 'color-mix(in srgb, var(--ui-accent) 12%, transparent)' : 'transparent'};" onclick={() => layout.set(opt.value)}>{opt.label}</button>
            {/each}
          </nav>
        </div>
        <div class="flex items-center gap-2 shrink-0" style="{HEADER_GROUP_GAP}" role="group" aria-label="Arena panels">
          <span class="text-[11px]" style="color: var(--ui-text-secondary);" title="Alt+1–4">Panels</span>
          <div class="flex gap-0.5" role="group" aria-label="Arena panel count">
            {#each [1, 2, 3, 4] as n}
              <button type="button" class="w-8 h-7 rounded-md text-xs font-medium transition-opacity {$arenaPanelCount === n ? '' : 'opacity-60'}" style="{$arenaPanelCount === n ? 'background: color-mix(in srgb, var(--ui-accent) 14%, transparent); color: var(--ui-accent);' : 'color: var(--ui-text-secondary);'}" onclick={() => arenaPanelCount.set(n)} aria-label="{n} panel{n === 1 ? '' : 's'} (Alt+{n})" aria-pressed={$arenaPanelCount === n} title="{n} panel{n === 1 ? '' : 's'} — Alt+{n}">{n}</button>
            {/each}
          </div>
          <span class="text-[11px]" style="color: var(--ui-text-secondary);">Chat → A</span>
        </div>
        <div class="shrink-0" style="{HEADER_PRESET_MIN}" title="Global system prompt preset. Arena slots can override via Options."><PresetSelect compact={true} /></div>
        <div class="flex items-center shrink-0 pl-3" style="{HEADER_GROUP_GAP} {HEADER_THEME_MIN}" role="group" aria-label="Appearance">
          <UiThemeSelect compact={true} />
          <ThemeToggle />
        </div>
        <div class="flex-1 min-w-4 shrink" aria-hidden="true"></div>
        <div class="flex items-center shrink-0" style="{HEADER_GROUP_GAP} {HEADER_RIGHT_GROUP}" role="group" aria-label="Status">
          <span class="flex items-center gap-1.5 shrink-0 text-xs" style="color: var(--ui-text-secondary);" title={lmStatusMessage} aria-label={lmStatusMessage}>
            <span class="w-2 h-2 rounded-full shrink-0" style="background-color: {$lmStudioConnected === true ? '#22c55e' : $lmStudioConnected === false ? '#ef4444' : '#94a3b8'};" aria-hidden="true"></span>
            <span class="hidden sm:inline">{lmStatusMessage}</span>
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
