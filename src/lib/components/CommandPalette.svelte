<script>
  import { onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import {
    layout,
    uiTheme,
    selectedModelId,
    activeConversationId,
    conversations,
    models,
    settingsOpen,
    chatCommand,
    webSearchForNextMessage,
    shortcutsModalOpen,
    cockpitIntelOpen,
    confirm,
  } from '$lib/stores.js';
  import { createConversation, listConversations, getMessageCount } from '$lib/db.js';
  import { bulkEraseChats } from '$lib/bulkEraseChats.js';
  import { UI_THEME_OPTIONS } from '$lib/themeOptions.js';

  let modelsList = $state([]);
  let conversationsList = $state([]);
  $effect(() => {
    const unsubM = models.subscribe((v) => (modelsList = v ?? []));
    const unsubC = conversations.subscribe((v) => (conversationsList = v ?? []));
    return () => {
      unsubM();
      unsubC();
    };
  });

  const LAYOUT_OPTIONS = [
    { value: 'cockpit', label: 'Cockpit' },
    { value: 'arena', label: 'Arena' },
  ];

  function loadRecentCommands() {
    if (typeof localStorage === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('recentPaletteCommands') || '[]').slice(0, 5); } catch { return []; }
  }
  let recentIds = $state(loadRecentCommands());
  function trackRecent(id) {
    recentIds = [id, ...recentIds.filter((r) => r !== id)].slice(0, 5);
    if (typeof localStorage !== 'undefined') localStorage.setItem('recentPaletteCommands', JSON.stringify(recentIds));
  }

  let open = $state(false);
  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state(null);

  /** Simple fuzzy match: query chars appear in order in str (case-insensitive). */
  function fuzzyMatch(str, q) {
    if (!q) return true;
    const s = (str ?? '').toLowerCase();
    const qn = q.toLowerCase().trim();
    let j = 0;
    for (let i = 0; i < s.length && j < qn.length; i++) {
      if (s[i] === qn[j]) j++;
    }
    return j === qn.length;
  }

  /** Build flat list of items with category for display. */
  function buildItems($models, $conversations) {
    const items = [];
    const q = query.trim();

    // Actions
    const actions = [
      { id: 'new-chat', label: 'New Chat', shortcut: 'Ctrl+N', category: 'Actions', run: () => runNewChat() },
      { id: 'search-web', label: 'Include web search for next message', shortcut: '', category: 'Actions', run: () => webSearchForNextMessage.set(true) },
      { id: 'export-chat', label: 'Export Chat', shortcut: 'Ctrl+Shift+E', category: 'Actions', run: () => chatCommand.set({ type: 'export', ts: Date.now() }) },
      { id: 'clear-chat', label: 'Clear Chat', shortcut: 'Ctrl+Shift+L', category: 'Actions', run: () => chatCommand.set({ type: 'clear', ts: Date.now() }) },
      { id: 'bulk-erase', label: 'Bulk erase all chats', shortcut: '', category: 'Actions', run: () => runBulkErase() },
      { id: 'settings', label: 'Open Settings', shortcut: '', category: 'Actions', run: () => settingsOpen.set(true) },
    ];
    actions.forEach((a) => {
      if (fuzzyMatch(a.label + ' ' + (a.shortcut || ''), q)) items.push(a);
    });

    // Models
    ($models || []).forEach((m) => {
      const id = m.id || m;
      const label = typeof id === 'string' ? id : id.id;
      if (fuzzyMatch(label, q)) items.push({ id: 'model-' + label, label, category: 'Models', run: () => selectedModelId.set(label) });
    });

    // Layouts
    LAYOUT_OPTIONS.forEach((opt) => {
      if (fuzzyMatch(opt.label + ' ' + opt.value, q)) items.push({ id: 'layout-' + opt.value, label: 'Layout: ' + opt.label, category: 'Layouts', run: () => layout.set(opt.value) });
    });

    // Themes
    UI_THEME_OPTIONS.forEach((opt) => {
      if (fuzzyMatch(opt.label + ' ' + opt.value, q)) items.push({ id: 'theme-' + opt.value, label: 'Theme: ' + opt.label, category: 'Themes', run: () => uiTheme.set(opt.value) });
    });

    // Conversations
    ($conversations || []).forEach((c) => {
      const title = (c.title || 'Untitled').trim() || 'Untitled';
      if (fuzzyMatch(title, q)) items.push({ id: 'conv-' + c.id, label: title, category: 'Conversations', run: () => activeConversationId.set(c.id) });
    });

    // Prepend recent commands when search is empty
    if (!q && recentIds.length > 0) {
      const recent = [];
      for (const rid of recentIds) {
        const match = items.find((it) => it.id === rid);
        if (match) recent.push({ ...match, category: 'Recent' });
      }
      if (recent.length) items.unshift(...recent);
    }

    return items;
  }

  async function runNewChat() {
    const id = await createConversation();
    let list = await listConversations();
    list = await Promise.all(list.map(async (c) => ({ ...c, messageCount: await getMessageCount(c.id) })));
    conversations.set(list);
    activeConversationId.set(id);
  }

  async function runBulkErase() {
    const n = conversationsList?.length ?? 0;
    if (n === 0) {
      closePalette();
      return;
    }
    closePalette();
    if (!(await confirm({ title: 'Are you sure?', message: `This will permanently delete all ${n} conversation${n === 1 ? '' : 's'}. This cannot be undone.`, confirmLabel: 'Yes, delete all', cancelLabel: 'Cancel', danger: true }))) return;
    await bulkEraseChats();
  }

  let items = $derived(buildItems(modelsList, conversationsList));

  function openPalette() {
    open = true;
    query = '';
    selectedIndex = 0;
    setTimeout(() => inputEl?.focus(), 50);
  }

  function closePalette() {
    open = false;
    query = '';
  }

  function runSelected() {
    const list = items;
    if (list.length === 0) return;
    const idx = ((selectedIndex % list.length) + list.length) % list.length;
    const item = list[idx];
    if (item?.run) {
      trackRecent(item.id);
      item.run();
      closePalette();
    }
  }

  function onKeydown(e) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = items.length ? (selectedIndex + 1) % items.length : 0;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = items.length ? (selectedIndex - 1 + items.length) % items.length : 0;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      runSelected();
      return;
    }
  }

  onMount(() => {
    function globalKeydown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        runNewChat();
        return;
      }
      if (e.key === '?' && !open) {
        const t = document.activeElement?.tagName?.toLowerCase();
        if (t !== 'input' && t !== 'textarea' && !(document.activeElement?.getAttribute('contenteditable') === 'true')) {
          e.preventDefault();
          shortcutsModalOpen.set(true);
        }
        return;
      }
      if (e.key === '/' && !open) {
        const t = document.activeElement?.tagName?.toLowerCase();
        if (t !== 'input' && t !== 'textarea' && !(document.activeElement?.getAttribute('contenteditable') === 'true')) {
          e.preventDefault();
          openPalette();
        }
      }
      if (e.key === ']' && !e.ctrlKey && !e.metaKey && !e.altKey && !open) {
        const t = document.activeElement?.tagName?.toLowerCase();
        if (t !== 'input' && t !== 'textarea' && !(document.activeElement?.getAttribute('contenteditable') === 'true')) {
          cockpitIntelOpen.update((v) => !v);
        }
      }
    }
    document.addEventListener('keydown', globalKeydown);
    return () => document.removeEventListener('keydown', globalKeydown);
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div
    class="command-palette-backdrop fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4"
    role="dialog"
    aria-label="Command palette"
    tabindex="-1"
    onclick={(e) => e.target === e.currentTarget && closePalette()}
    onkeydown={(e) => { onKeydown(e); if (e.key === 'Escape' && e.target === e.currentTarget) closePalette(); }}
    transition:fade={{ duration: 200 }}>
    <div
      class="w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden"
      style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);"
      role="presentation"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      transition:scale={{ start: 0.72, duration: 500, easing: quintOut }}>
      <div class="flex items-center gap-2 px-4 py-3 border-b" style="border-color: var(--ui-border);">
        <span class="text-zinc-400 dark:text-zinc-500 shrink-0" aria-hidden="true">&#8250;</span>
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          class="flex-1 min-w-0 bg-transparent text-sm focus:outline-none"
          style="color: var(--ui-text-primary);"
          placeholder="Search commands, models, chats..."
          aria-label="Search" />
      </div>
      <div class="max-h-[60vh] overflow-y-auto py-2">
        {#if items.length === 0}
          <div class="px-4 py-6 text-center text-sm" style="color: var(--ui-text-secondary);">No matches</div>
        {:else}
          {#each items as item, i}
            {#if i === 0 || item.category !== items[i - 1]?.category}
              <div class="px-4 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider" style="color: var(--ui-text-secondary);">{item.category}</div>
            {/if}
            {@const isSelected = i === selectedIndex}
            <button
              type="button"
              class="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors {isSelected ? '' : ''}"
              style="background-color: {isSelected ? 'var(--ui-sidebar-active)' : 'transparent'}; color: var(--ui-text-primary);"
              onmouseenter={() => (selectedIndex = i)}
              onclick={() => { if (item.run) { trackRecent(item.id); item.run(); closePalette(); } }}>
              <span class="truncate">{item.label}</span>
              {#if item.shortcut}
                <span class="text-[10px] font-mono shrink-0 opacity-70" style="color: var(--ui-text-secondary);">{item.shortcut}</span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
