<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { fly } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import { theme, sidebarOpen, settingsOpen, layout, dashboardModelA, dashboardModelB, dashboardModelC, dashboardModelD, activeConversationId, conversations, selectedModelId, uiTheme, sidebarCollapsed, cockpitIntelOpen, arenaPanelCount, arenaSlotAIsJudge, models, lmStudioConnected } from '$lib/stores.js';
  import { createConversation, listConversations, getMessageCount, getMessages } from '$lib/db.js';
  import { getModels } from '$lib/api.js';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import ChatView from '$lib/components/ChatView.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import UiThemeSelect from '$lib/components/UiThemeSelect.svelte';
  import PresetSelect from '$lib/components/PresetSelect.svelte';
  import ModelSelector from '$lib/components/ModelSelector.svelte';
  import ModelSelectorSlot from '$lib/components/ModelSelectorSlot.svelte';
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

  const LAYOUT_OPTS = [
    { value: 'cockpit', label: 'Cockpit' },
    { value: 'arena', label: 'Arena' },
  ];
  const HEADER_MODEL_MIN = 'min-width: 13rem;';
  const HEADER_PRESET_MIN = 'min-width: 7rem;';
  const HEADER_THEME_MIN = 'min-width: 10rem;';
  const HEADER_GROUP_GAP = 'gap: 0.75rem;';
  const HEADER_BETWEEN_GROUPS = '1.25rem';
  const HEADER_RIGHT_GROUP = 'margin-left: auto;';

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

  let intelTabBounce = false;
  function toggleIntel() {
    cockpitIntelOpen.update((v) => !v);
    intelTabBounce = true;
    setTimeout(() => (intelTabBounce = false), 420);
  }

  let sidebarTabBounce = false;
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
      <header class="shrink-0 flex items-center flex-wrap px-3 py-2 border-b text-sm" style="border-color: var(--ui-border); background-color: var(--ui-bg-sidebar); color: var(--ui-text-secondary); gap: {HEADER_BETWEEN_GROUPS};">
        <div class="flex items-center shrink-0" style="{HEADER_GROUP_GAP}" role="group" aria-label="Brand and layout">
          <span class="flex items-center gap-1.5 font-semibold shrink-0" style="color: var(--ui-accent);"><AtomLogo size={20} />ATOM</span>
          <nav class="flex items-center gap-0.5 shrink-0" aria-label="Layout">
            {#each LAYOUT_OPTS as opt}
              <button type="button" class="px-2 py-1 rounded text-xs {$layout === opt.value ? 'font-medium' : ''}" style="color: {$layout === opt.value ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'}; background: {$layout === opt.value ? 'color-mix(in srgb, var(--ui-accent) 15%, transparent)' : 'transparent'};" onclick={() => layout.set(opt.value)}>{opt.label}</button>
            {/each}
          </nav>
        </div>
        <div class="flex items-center shrink-0 overflow-hidden" style="{HEADER_GROUP_GAP}" role="group" aria-label="Model and preset">
          <div class="shrink-0 overflow-hidden" style="{HEADER_MODEL_MIN}"><ModelSelector /></div>
          <div class="shrink-0" style="{HEADER_PRESET_MIN}"><PresetSelect compact={true} /></div>
        </div>
        <div class="flex items-center shrink-0 pl-2 border-l" style="border-color: var(--ui-border); {HEADER_GROUP_GAP} {HEADER_THEME_MIN}" role="group" aria-label="Appearance">
          <UiThemeSelect compact={true} />
          <ThemeToggle />
        </div>
        <div class="flex-1 min-w-4 shrink" aria-hidden="true"></div>
        <div class="flex items-center shrink-0" style="{HEADER_GROUP_GAP} {HEADER_RIGHT_GROUP}" role="group" aria-label="Status">
          <span class="flex items-center gap-1.5 shrink-0 text-xs" style="color: var(--ui-text-secondary);" title={$lmStudioConnected === true ? 'LM Studio connected' : $lmStudioConnected === false ? 'LM Studio not reachable' : 'Checking...'} aria-label={$lmStudioConnected === true ? 'LM Studio connected' : $lmStudioConnected === false ? 'LM Studio not reachable' : 'Checking connection'}>
            <span class="w-2 h-2 rounded-full shrink-0" style="background-color: {$lmStudioConnected === true ? '#22c55e' : $lmStudioConnected === false ? '#ef4444' : '#94a3b8'};" aria-hidden="true"></span>
            <span class="hidden sm:inline">LM Studio</span>
          </span>
        </div>
      </header>
      <div class="flex flex-1 min-h-0 min-w-0 relative">
        <ConvoRail />
        <main class="flex-1 flex flex-col min-w-0 min-h-0" style="background-color: var(--ui-bg-main);">
          <ChatView />
        </main>
        {#if $cockpitIntelOpen}
          <aside
            class="w-[280px] shrink-0 border-l overflow-visible flex flex-col relative"
            style="border-color: var(--ui-border);"
            in:fly={{ x: 280, duration: 400, easing: backOut }}
            out:fly={{ x: 280, duration: 300, easing: quintOut }}
          >
            <button
              type="button"
              class="panel-tab {intelTabBounce ? 'panel-tab-bounce' : ''}"
              style="--panel-tab-transform: translate(-100%, -50%); left: 0; top: 50%; border-right: none; border-radius: 6px 0 0 6px;"
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
          <div class="intel-tab-strip shrink-0 w-7 flex items-center justify-center relative min-h-0 border-l" style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);">
            <button
              type="button"
              class="panel-tab {intelTabBounce ? 'panel-tab-bounce' : ''}"
              style="--panel-tab-transform: translateY(-50%); left: 0; top: 50%; border-right: none; border-radius: 6px 0 0 6px;"
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
      <header class="shrink-0 flex items-center flex-wrap px-3 py-2 border-b text-sm" style="border-color: var(--ui-border); background-color: var(--ui-bg-sidebar); color: var(--ui-text-secondary); gap: {HEADER_BETWEEN_GROUPS};">
        <div class="flex items-center shrink-0" style="{HEADER_GROUP_GAP}" role="group" aria-label="Brand and layout">
          <button type="button" class="md:hidden p-2 rounded min-h-[44px] min-w-[44px] flex items-center justify-center" style="color: var(--ui-text-secondary);" onclick={() => sidebarOpen.set(true)} aria-label="Open menu">☰</button>
          <span class="flex items-center gap-1.5 font-semibold shrink-0" style="color: var(--ui-accent);"><AtomLogo size={20} />ATOM Arena</span>
          <nav class="flex items-center gap-0.5 shrink-0" aria-label="Layout">
            {#each LAYOUT_OPTS as opt}
              <button type="button" class="px-2 py-1 rounded text-xs {$layout === opt.value ? 'font-medium' : ''}" style="color: {$layout === opt.value ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'}; background: {$layout === opt.value ? 'color-mix(in srgb, var(--ui-accent) 15%, transparent)' : 'transparent'};" onclick={() => layout.set(opt.value)}>{opt.label}</button>
            {/each}
          </nav>
        </div>
        <div class="flex items-center gap-2 shrink-0" style="{HEADER_GROUP_GAP}" role="group" aria-label="Arena panels">
          <span class="text-xs" style="color: var(--ui-text-secondary);" title="Alt+1 through Alt+4 to switch">Panels</span>
          <div class="flex rounded-lg border overflow-hidden" style="border-color: var(--ui-border);" role="group" aria-label="Arena panel count">
            {#each [1, 2, 3, 4] as n}
              <button type="button" class="w-8 h-7 text-xs font-medium transition-colors {$arenaPanelCount === n ? '' : 'opacity-70'}" style="{$arenaPanelCount === n ? 'background-color: var(--ui-sidebar-active); color: var(--ui-text-primary);' : 'background-color: var(--ui-bg-main); color: var(--ui-text-secondary);'}" onclick={() => arenaPanelCount.set(n)} aria-label="{n} panel{n === 1 ? '' : 's'} (Alt+{n})" aria-pressed={$arenaPanelCount === n} title="{n} panel{n === 1 ? '' : 's'} — Alt+{n}">{n}</button>
            {/each}
          </div>
          <span class="text-xs" style="color: var(--ui-text-secondary);">Chat uses Model A</span>
        </div>
        <div class="shrink-0" style="{HEADER_PRESET_MIN}"><PresetSelect compact={true} /></div>
        <div class="flex items-center shrink-0 pl-2 border-l" style="border-color: var(--ui-border); {HEADER_GROUP_GAP} {HEADER_THEME_MIN}" role="group" aria-label="Appearance">
          <UiThemeSelect compact={true} />
          <ThemeToggle />
        </div>
        <div class="flex-1 min-w-4 shrink" aria-hidden="true"></div>
        <div class="flex items-center shrink-0" style="{HEADER_GROUP_GAP} {HEADER_RIGHT_GROUP}" role="group" aria-label="Status">
          <span class="flex items-center gap-1.5 shrink-0 text-xs" style="color: var(--ui-text-secondary);" title={$lmStudioConnected === true ? 'LM Studio connected' : $lmStudioConnected === false ? 'LM Studio not reachable' : 'Checking...'} aria-label={$lmStudioConnected === true ? 'LM Studio connected' : $lmStudioConnected === false ? 'LM Studio not reachable' : 'Checking connection'}>
            <span class="w-2 h-2 rounded-full shrink-0" style="background-color: {$lmStudioConnected === true ? '#22c55e' : $lmStudioConnected === false ? '#ef4444' : '#94a3b8'};" aria-hidden="true"></span>
            <span class="hidden sm:inline">LM Studio</span>
          </span>
        </div>
      </header>
      <div class="flex flex-1 min-h-0 relative">
        <aside
          class="shrink-0 border-r overflow-hidden hidden md:flex flex-col transition-[width] duration-200 relative min-w-0"
          style="width: {$sidebarCollapsed ? '44px' : '13rem'}; background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);">
          <button
            type="button"
            class="panel-tab {sidebarTabBounce ? 'panel-tab-bounce' : ''}"
            style="--panel-tab-transform: translate(100%, -50%); top: 50%; right: 0; border-left: none; border-radius: 0 6px 6px 0;"
            title={$sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={$sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
            <div class="absolute inset-0 bg-black/40" onclick={() => sidebarOpen.set(false)}></div>
            <aside class="absolute left-0 top-0 bottom-0 w-64 bg-white dark:bg-zinc-900 border-r shadow-xl" style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);"><Sidebar /></aside>
          </div>
        {/if}
        <div class="flex-1 flex flex-col min-w-0">
          <div class="grid gap-2 p-2 border-b" style="border-color: var(--ui-border); grid-template-columns: repeat({$arenaPanelCount}, minmax(0, 1fr));">
            {#if $arenaPanelCount >= 1}
              <div class="rounded-lg border p-2 flex flex-col gap-1.5" style="border-color: var(--ui-border); background-color: var(--ui-input-bg);">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-medium" style="color: var(--ui-text-secondary);">Model A</span>
                  <label class="flex items-center gap-1.5 cursor-pointer" title="Use Slot A as judge: it won't answer the prompt; click Judgment time to rate B/C/D">
                    <input type="checkbox" bind:checked={$arenaSlotAIsJudge} class="rounded border-zinc-300 dark:border-zinc-600" style="accent-color: var(--ui-accent);" />
                    <span class="text-[10px]" style="color: var(--ui-text-secondary);">Use as judge</span>
                  </label>
                </div>
                <ModelSelectorSlot slot="A" />
              </div>
            {/if}
            {#if $arenaPanelCount >= 2}
              <div class="rounded-lg border p-2 flex flex-col gap-1.5" style="border-color: var(--ui-border); background-color: var(--ui-input-bg);">
                <span class="text-xs font-medium" style="color: var(--ui-text-secondary);">Model B</span>
                <ModelSelectorSlot slot="B" />
              </div>
            {/if}
            {#if $arenaPanelCount >= 3}
              <div class="rounded-lg border p-2 flex flex-col gap-1.5" style="border-color: var(--ui-border); background-color: var(--ui-input-bg);">
                <span class="text-xs font-medium" style="color: var(--ui-text-secondary);">Model C</span>
                <ModelSelectorSlot slot="C" />
              </div>
            {/if}
            {#if $arenaPanelCount >= 4}
              <div class="rounded-lg border p-2 flex flex-col gap-1.5" style="border-color: var(--ui-border); background-color: var(--ui-input-bg);">
                <span class="text-xs font-medium" style="color: var(--ui-text-secondary);">Model D</span>
                <ModelSelectorSlot slot="D" />
              </div>
            {/if}
          </div>
          <div class="flex-1 min-h-0 h-full"><DashboardArena /></div>
        </div>
      </div>
    </div>

  {/if}

  {#if $settingsOpen}
    <SettingsPanel onclose={() => settingsOpen.set(false)} />
  {/if}
</div>
