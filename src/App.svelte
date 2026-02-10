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
  import FloatingMetricsDashboard from '$lib/components/FloatingMetricsDashboard.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import { checkLmStudioConnection } from '$lib/api.js';

  const LAYOUT_OPTS = [
    { value: 'cockpit', label: 'Cockpit' },
    { value: 'arena', label: 'Arena' },
  ];
  const HEADER_MODEL_MIN = 'min-width: 13rem;';
  const HEADER_PRESET_MIN = 'min-width: 7rem;';
  const HEADER_THEME_MIN = 'min-width: 10rem;';
  const HEADER_GAP = 'gap: 1.25rem;';

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
  onMount(() => { document.documentElement.dataset.uiTheme = get(uiTheme); });

  onMount(() => {
    let pollId;
    async function pollConnection() {
      lmStudioConnected.set(await checkLmStudioConnection());
      pollId = setTimeout(pollConnection, 10000);
    }
    pollConnection();
    return () => clearTimeout(pollId);
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
</script>

<div class="h-screen overflow-hidden" style="background-color: var(--ui-bg-main);">
  <AudioManager />
  <CommandPalette />
  <FloatingMetricsDashboard />
  <ConfirmModal />
  <ShortcutsModal />

  {#if $layout === 'cockpit'}
    <div class="flex h-full flex-col">
      <header class="shrink-0 flex items-center flex-wrap px-3 py-2 border-b text-sm" style="border-color: var(--ui-border); background-color: var(--ui-bg-sidebar); color: var(--ui-text-secondary); {HEADER_GAP}">
        <span class="font-semibold shrink-0 w-10" style="color: var(--ui-accent);">ATOM</span>
        <nav class="flex items-center gap-0.5 shrink-0" aria-label="Layout">
          {#each LAYOUT_OPTS as opt}
            <button type="button" class="px-2 py-1 rounded text-xs {$layout === opt.value ? 'font-medium' : ''}" style="color: {$layout === opt.value ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'}; background: {$layout === opt.value ? 'color-mix(in srgb, var(--ui-accent) 15%, transparent)' : 'transparent'};" onclick={() => layout.set(opt.value)}>{opt.label}</button>
          {/each}
        </nav>
        <div class="shrink-0 overflow-hidden" style="{HEADER_MODEL_MIN}"><ModelSelector /></div>
        <div class="shrink-0" style="{HEADER_PRESET_MIN}"><PresetSelect compact={true} /></div>
        <div class="flex items-center gap-1.5 shrink-0 pl-2 ml-2 border-l" style="border-color: var(--ui-border); {HEADER_THEME_MIN}" role="group" aria-label="Theme">
          <UiThemeSelect compact={true} />
          <ThemeToggle />
        </div>
        <span class="flex items-center gap-1.5 shrink-0 text-xs" style="color: var(--ui-text-secondary);" title={$lmStudioConnected === true ? 'LM Studio connected' : $lmStudioConnected === false ? 'LM Studio not reachable' : 'Checking...'} aria-label={$lmStudioConnected === true ? 'LM Studio connected' : $lmStudioConnected === false ? 'LM Studio not reachable' : 'Checking connection'}>
          <span class="w-2 h-2 rounded-full shrink-0" style="background-color: {$lmStudioConnected === true ? '#22c55e' : $lmStudioConnected === false ? '#ef4444' : '#94a3b8'};" aria-hidden="true"></span>
          <span class="hidden sm:inline">LM Studio</span>
        </span>
        <button type="button" class="flex items-center gap-1.5 px-3 py-2 rounded-lg shrink-0 min-h-[44px] text-base transition-colors hover:opacity-90" style="color: var(--ui-text-secondary); background: color-mix(in srgb, var(--ui-border) 30%, transparent);" onclick={() => settingsOpen.set(true)} aria-label="Settings" title="Settings"><span class="text-lg leading-none" aria-hidden="true">⚙</span><span class="text-xs font-medium hidden sm:inline">Settings</span></button>
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
            <div class="flex-1 overflow-hidden flex flex-col min-h-0">
              <IntelPanel />
            </div>
          </aside>
        {:else}
          <div class="shrink-0 w-0 overflow-visible relative min-h-0">
            <button
              type="button"
              class="panel-tab {intelTabBounce ? 'panel-tab-bounce' : ''}"
              style="--panel-tab-transform: translate(-100%, -50%); left: 0; top: 50%; border-right: none; border-radius: 6px 0 0 6px;"
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
      <header class="shrink-0 flex items-center justify-between px-3 py-2 border-b flex-wrap" style="border-color: var(--ui-border); background-color: var(--ui-bg-sidebar); {HEADER_GAP}">
        <div class="flex items-center gap-2 shrink-0">
          <button type="button" class="md:hidden p-2 rounded min-h-[44px] min-w-[44px] flex items-center justify-center" style="color: var(--ui-text-secondary);" onclick={() => sidebarOpen.set(true)} aria-label="Open menu">☰</button>
          <span class="font-semibold shrink-0" style="color: var(--ui-accent);">ATOM Arena</span>
        </div>
        <nav class="flex items-center gap-0.5 shrink-0" aria-label="Layout">
          {#each LAYOUT_OPTS as opt}
            <button type="button" class="px-2 py-1 rounded text-xs {$layout === opt.value ? 'font-medium' : ''}" style="color: {$layout === opt.value ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'}; background: {$layout === opt.value ? 'color-mix(in srgb, var(--ui-accent) 15%, transparent)' : 'transparent'};" onclick={() => layout.set(opt.value)}>{opt.label}</button>
          {/each}
        </nav>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-xs" style="color: var(--ui-text-secondary);">Panels</span>
          <div class="flex rounded-lg border overflow-hidden" style="border-color: var(--ui-border);">
            {#each [1, 2, 3, 4] as n}
              <button type="button" class="w-8 h-7 text-xs font-medium transition-colors {$arenaPanelCount === n ? '' : 'opacity-70'}" style="{$arenaPanelCount === n ? 'background-color: var(--ui-sidebar-active); color: var(--ui-text-primary);' : 'background-color: var(--ui-bg-main); color: var(--ui-text-secondary);'}" onclick={() => arenaPanelCount.set(n)} aria-label="{n} panel{n === 1 ? '' : 's'}" aria-pressed={$arenaPanelCount === n}>{n}</button>
            {/each}
          </div>
          <span class="text-xs" style="color: var(--ui-text-secondary);">Chat uses Model A</span>
        </div>
        <div class="shrink-0" style="{HEADER_PRESET_MIN}"><PresetSelect compact={true} /></div>
        <div class="flex items-center gap-1.5 shrink-0 pl-2 ml-2 border-l" style="border-color: var(--ui-border); {HEADER_THEME_MIN}" role="group" aria-label="Theme">
          <UiThemeSelect compact={true} />
          <ThemeToggle />
        </div>
        <span class="flex items-center gap-1.5 shrink-0 text-xs" style="color: var(--ui-text-secondary);" title={$lmStudioConnected === true ? 'LM Studio connected' : $lmStudioConnected === false ? 'LM Studio not reachable' : 'Checking...'} aria-label={$lmStudioConnected === true ? 'LM Studio connected' : $lmStudioConnected === false ? 'LM Studio not reachable' : 'Checking connection'}>
          <span class="w-2 h-2 rounded-full shrink-0" style="background-color: {$lmStudioConnected === true ? '#22c55e' : $lmStudioConnected === false ? '#ef4444' : '#94a3b8'};" aria-hidden="true"></span>
          <span class="hidden sm:inline">LM Studio</span>
        </span>
        <button type="button" class="flex items-center gap-1.5 px-3 py-2 rounded-lg shrink-0 min-h-[44px] text-base transition-colors hover:opacity-90" style="color: var(--ui-text-secondary); background: color-mix(in srgb, var(--ui-border) 30%, transparent);" onclick={() => settingsOpen.set(true)} aria-label="Settings" title="Settings"><span class="text-lg leading-none" aria-hidden="true">⚙</span><span class="text-xs font-medium hidden sm:inline">Settings</span></button>
      </header>
      <div class="flex flex-1 min-h-0 relative">
        <aside class="w-52 shrink-0 border-r overflow-auto hidden md:block" style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);"><Sidebar /></aside>
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
