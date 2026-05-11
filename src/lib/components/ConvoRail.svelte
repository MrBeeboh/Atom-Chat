<!--
  ConvoRail: compact conversation rail (collapsible). Collapsed = 5 category icons only.
  Expanded = section-based: History (grouped list), Search, or Pinned.
-->
<script>
  import { onMount } from 'svelte';
  import { activeConversationId, conversations, layout, confirm, settingsOpen } from '$lib/stores.js';
  import { listConversations, createConversation, deleteConversation, getMessageCount, toggleConversationPin } from '$lib/db.js';
  import { bulkEraseChats } from '$lib/bulkEraseChats.js';
  import { groupByDate } from '$lib/utils.js';

  let expanded = $state(false);
  /** 'history' | 'search' | 'pinned' — which section is shown when expanded */
  let activeSection = $state('history');
  let convosList = $state([]);
  const groups = $derived(groupByDate(convosList));
  let activeId = $state(null);
  let layoutVal = $state('flow');
  let searchQuery = $state('');
  const filteredList = $derived(
    searchQuery.trim() === ''
      ? convosList
      : convosList.filter(
          (c) =>
            (c.title || '').toLowerCase().includes(searchQuery.trim().toLowerCase())
        )
  );
  const filteredGroups = $derived(groupByDate(filteredList));
  const pinnedList = $derived((convosList || []).filter((c) => c.pinned === true));
  const pinnedGroups = $derived(groupByDate(pinnedList));

  $effect(() => {
    const unsubC = conversations.subscribe((v) => (convosList = v ?? []));
    const unsubA = activeConversationId.subscribe((v) => (activeId = v));
    const unsubL = layout.subscribe((v) => (layoutVal = v));
    return () => {
      unsubC();
      unsubA();
      unsubL();
    };
  });

  onMount(() => {
    function onKeydown(e) {
      if (layoutVal !== 'cockpit') return;
      if (e.key === '[' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        expanded = !expanded;
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });

  async function loadConversations() {
    let list = await listConversations();
    if (list.length === 0) {
      const id = await createConversation();
      activeConversationId.set(id);
      await loadConversations();
      return;
    }
    list = await Promise.all(list.map(async (c) => ({ ...c, messageCount: await getMessageCount(c.id) })));
    conversations.set(list);
    if (!activeId) activeConversationId.set(list[0].id);
  }

  onMount(loadConversations);

  async function newChat() {
    const id = await createConversation();
    await loadConversations();
    activeConversationId.set(id);
  }

  function select(id) {
    activeConversationId.set(id);
  }

  async function remove(ev, id) {
    ev.stopPropagation();
    if (!(await confirm({ title: 'Delete conversation', message: 'Delete this conversation?' }))) return;
    await deleteConversation(id);
    if (activeId === id) activeConversationId.set(null);
    await loadConversations();
  }

  async function onBulkErase() {
    const n = convosList?.length ?? 0;
    if (n === 0) return;
    if (!(await confirm({
      title: 'Are you sure?',
      message: `This will permanently delete all ${n} conversation${n === 1 ? '' : 's'}. This cannot be undone.`,
      confirmLabel: 'Yes, delete all',
      cancelLabel: 'Cancel',
      danger: true,
    }))) return;
    await bulkEraseChats();
  }

  let tabBounce = $state(false);
  function toggleExpanded() {
    expanded = !expanded;
    tabBounce = true;
    const t = setTimeout(() => (tabBounce = false), 420);
    return () => clearTimeout(t);
  }

  function expandTo(section) {
    activeSection = section;
    expanded = true;
  }

  function openSettings() {
    settingsOpen.set(true);
  }

  async function onTogglePin(ev, convId) {
    ev.stopPropagation();
    await toggleConversationPin(convId);
    await loadConversations();
  }
</script>

<div
  class="convo-rail flex flex-col shrink-0 overflow-visible transition-[width] duration-200 relative min-w-0"
  style="width: {expanded ? '200px' : '44px'}; max-width: {expanded ? '200px' : '44px'}; background-color: var(--ui-bg-sidebar);">
  <!-- Protruded arrow tab midway on right edge: out = expand, in = retract -->
  <button
    type="button"
    class="panel-tab {tabBounce ? 'panel-tab-bounce' : ''}"
    style="--panel-tab-transform: translate(100%, -50%); top: 50%; right: 0;"
    title={expanded ? 'Collapse ([)' : 'Expand ([)'}
    aria-label={expanded ? 'Collapse rail' : 'Expand rail'}
    onclick={toggleExpanded}>
    {#if expanded}
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
    {:else}
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
    {/if}
  </button>
  <!-- Content wrapper: clips to rail width -->
  <div class="flex flex-1 flex-col min-w-0 overflow-hidden">
    {#if !expanded}
      <!-- Collapsed: icon buttons with text labels below each icon -->
      <div class="rail-icons flex flex-col items-center gap-0.5 pt-3 shrink-0" style="color: var(--ui-text-secondary);">
        <button
          type="button"
          class="rail-icon-labeled"
          style="color: var(--ui-accent);"
          onclick={newChat}
          title="New chat"
          aria-label="New chat">
          <svg class="rail-icon-svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          <span class="rail-icon-label">New</span>
        </button>
        <button
          type="button"
          class="rail-icon-labeled"
          class:rail-active={activeSection === 'search'}
          style:color={activeSection === 'search' ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'}
          onclick={() => expandTo('search')}
          title="Search chats"
          aria-label="Search">
          <svg class="rail-icon-svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4-4" /></svg>
          <span class="rail-icon-label">Search</span>
        </button>
        <button
          type="button"
          class="rail-icon-labeled"
          class:rail-active={activeSection === 'pinned'}
          style:color={activeSection === 'pinned' ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'}
          onclick={() => expandTo('pinned')}
          title="Pinned chats"
          aria-label="Pinned">
          <svg class="rail-icon-svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3 3-1 7 2 3v2H8v-2l2-3-1-7 3-3z" /><circle cx="12" cy="22" r="1.5" fill="currentColor" stroke="none" /></svg>
          <span class="rail-icon-label">Pinned</span>
        </button>
        <button
          type="button"
          class="rail-icon-labeled"
          class:rail-active={activeSection === 'history'}
          style:color={activeSection === 'history' ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'}
          onclick={() => expandTo('history')}
          title="Chat history"
          aria-label="History">
          <svg class="rail-icon-svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          <span class="rail-icon-label">History</span>
        </button>
        <div class="w-5 my-1" style="height: 1px; background: var(--ui-border);" aria-hidden="true"></div>
        <button
          type="button"
          class="rail-icon-labeled"
          style="color: var(--ui-text-secondary);"
          onclick={openSettings}
          title="Settings"
          aria-label="Settings">
          <svg class="rail-icon-svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" /></svg>
          <span class="rail-icon-label">Settings</span>
        </button>
      </div>
    {:else}
      <!-- Expanded: section header + content -->
      <button
        type="button"
        class="shrink-0 w-full min-w-0 py-1.5 px-2 rounded mx-1 text-xs font-medium flex items-center justify-center gap-1"
        style="background: var(--ui-accent); color: var(--ui-bg-main);"
        onclick={newChat}
        title="New chat">
        + New
      </button>
      {#if activeSection === 'history' && (convosList?.length ?? 0) > 0}
        <button
          type="button"
          class="bulk-erase-link shrink-0 text-xs mt-1 mx-1 py-1 flex items-center gap-1.5 transition-opacity hover:opacity-80"
          style="color: var(--ui-accent-hot, #dc2626); background: none; border: none;"
          onclick={onBulkErase}
          title="Permanently delete all conversations (you will be asked to confirm)">
          <span aria-hidden="true">⚠</span>
          Bulk erase all
        </button>
      {/if}

      {#if activeSection === 'search'}
        <div class="shrink-0 px-2 pt-2 pb-1">
          <input
            type="search"
            class="w-full py-1.5 px-2 text-xs rounded min-w-0"
            style="background: color-mix(in srgb, var(--ui-border) 15%, var(--ui-bg-main)); color: var(--ui-text-primary);"
            placeholder="Search chats..."
            bind:value={searchQuery}
            aria-label="Search conversations" />
        </div>
        <ul class="flex-1 overflow-y-auto overflow-x-hidden mt-1 space-y-0.5 px-1 min-h-0 min-w-0">
          {#if filteredList.length === 0}
            <li class="px-2 py-4 text-xs" style="color: var(--ui-text-secondary);">No conversations match "{searchQuery}"</li>
          {:else}
          {#each ['today', 'yesterday', 'week', 'older'] as key}
            {#if filteredGroups[key]?.length > 0}
              <li class="px-2 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider" style="color: var(--ui-text-secondary);">{key === 'today' ? 'Today' : key === 'yesterday' ? 'Yesterday' : key === 'week' ? 'This week' : 'Older'}</li>
              {#each filteredGroups[key] as conv}
                {@const isActive = activeId === conv.id}
                <li>
                  <div
                    role="button"
                    tabindex="0"
                    class="w-full text-left py-1.5 px-2 rounded flex items-center gap-2 min-w-0 cursor-pointer transition-colors group"
                    style:background={isActive ? 'var(--ui-sidebar-active)' : 'transparent'}
                    style:color={isActive ? 'var(--ui-text-primary)' : 'var(--ui-text-secondary)'}
                    onclick={() => select(conv.id)}
                    onkeydown={(e) => e.key === 'Enter' && select(conv.id)}>
                    <span class="truncate flex-1 text-xs min-w-0">{conv.title}</span>
                    <button type="button" class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-0.5 rounded shrink-0 text-[10px] hover:bg-black/10" style="color: var(--ui-text-secondary);" onclick={(e) => { e.stopPropagation(); remove(e, conv.id); }} aria-label="Delete">×</button>
                  </div>
                </li>
              {/each}
            {/if}
          {/each}
          {/if}
        </ul>
      {:else if activeSection === 'pinned'}
        <ul class="flex-1 overflow-y-auto overflow-x-hidden mt-1 space-y-0.5 px-1 min-h-0 min-w-0">
          {#if pinnedList.length === 0}
            <li class="px-2 py-4 text-xs" style="color: var(--ui-text-secondary);">No pinned conversations.</li>
          {:else}
            {#each ['today', 'yesterday', 'week', 'older'] as key}
              {#if pinnedGroups[key]?.length > 0}
                <li class="px-2 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider" style="color: var(--ui-text-secondary);">{key === 'today' ? 'Today' : key === 'yesterday' ? 'Yesterday' : key === 'week' ? 'This week' : 'Older'}</li>
                {#each pinnedGroups[key] as conv}
                  {@const isActive = activeId === conv.id}
                  <li>
                    <div
                      role="button"
                      tabindex="0"
                      class="w-full text-left py-1.5 px-2 rounded flex items-center gap-2 min-w-0 cursor-pointer transition-colors group"
                      style:background={isActive ? 'var(--ui-sidebar-active)' : 'transparent'}
                      style:color={isActive ? 'var(--ui-text-primary)' : 'var(--ui-text-secondary)'}
                      onclick={() => select(conv.id)}
                      onkeydown={(e) => e.key === 'Enter' && select(conv.id)}>
                      <button type="button" class="p-0.5 rounded shrink-0 hover:bg-black/10" style="color: var(--ui-accent);" onclick={(e) => onTogglePin(e, conv.id)} aria-label="Unpin" title="Unpin">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78 9.09A1 1 0 0 1 5 21v-1a1 1 0 0 1 .89-.99l1.81-.18L9 10.76zM15 10.76l1.11 8.07 1.81.18A1 1 0 0 0 19 21v-1a1 1 0 0 0-.89-1l-1.78-9.09A2 2 0 0 1 15 10.76zM20 10.76a2 2 0 0 0-1.11 1.79l-1.78 9.09A1 1 0 0 1 15 21v-1a1 1 0 0 1 .89-.99l1.81-.18M4 10.76a2 2 0 0 1 1.11 1.79l1.78 9.09A1 1 0 0 0 9 21v-1a1 1 0 0 0-.89-.99L6.3 19" /></svg>
                      </button>
                      <span class="truncate flex-1 text-xs min-w-0">{conv.title}</span>
                      <button type="button" class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-0.5 rounded shrink-0 text-[10px] hover:bg-black/10" style="color: var(--ui-text-secondary);" onclick={(e) => { e.stopPropagation(); remove(e, conv.id); }} aria-label="Delete">×</button>
                    </div>
                  </li>
                {/each}
              {/if}
            {/each}
          {/if}
        </ul>
      {:else}
        <!-- History: full grouped list with pin per row -->
        <ul class="flex-1 overflow-y-auto overflow-x-hidden mt-1 space-y-0.5 px-1 min-h-0 min-w-0">
          {#each ['today', 'yesterday', 'week', 'older'] as key}
            {#if groups[key]?.length > 0}
              <li class="px-2 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider" style="color: var(--ui-text-secondary);">{key === 'today' ? 'Today' : key === 'yesterday' ? 'Yesterday' : key === 'week' ? 'This week' : 'Older'}</li>
              {#each groups[key] as conv}
                {@const isActive = activeId === conv.id}
                <li>
                  <div
                    role="button"
                    tabindex="0"
                    class="w-full text-left py-1.5 px-2 rounded flex items-center gap-2 min-w-0 cursor-pointer transition-colors group"
                    style:background={isActive ? 'var(--ui-sidebar-active)' : 'transparent'}
                    style:color={isActive ? 'var(--ui-text-primary)' : 'var(--ui-text-secondary)'}
                    onclick={() => select(conv.id)}
                    onkeydown={(e) => e.key === 'Enter' && select(conv.id)}>
                    <button type="button" class="p-0.5 rounded shrink-0 hover:bg-black/10 {conv.pinned ? '' : 'opacity-50'}" style:color={conv.pinned ? 'var(--ui-accent)' : 'var(--ui-text-secondary)'} onclick={(e) => onTogglePin(e, conv.id)} aria-label={conv.pinned ? 'Unpin' : 'Pin'} title={conv.pinned ? 'Unpin' : 'Pin'}>
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78 9.09A1 1 0 0 1 5 21v-1a1 1 0 0 1 .89-.99l1.81-.18" /><path d="M15 10.76a2 2 0 0 0 1.11 1.79l1.78 9.09A1 1 0 0 0 19 21v-1a1 1 0 0 0-.89-.99l-1.81-.18" /><path d="M20 10.76a2 2 0 0 0-1.11 1.79l-1.78 9.09A1 1 0 0 1 15 21v-1a1 1 0 0 1 .89-.99l1.81-.18" /><path d="M4 10.76a2 2 0 0 1 1.11 1.79l1.78 9.09A1 1 0 0 0 9 21v-1a1 1 0 0 0-.89-.99L6.3 19" /></svg>
                    </button>
                    <span class="truncate flex-1 text-xs min-w-0">{conv.title}</span>
                    <button type="button" class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-0.5 rounded shrink-0 text-[10px] hover:bg-black/10" style="color: var(--ui-text-secondary);" onclick={(e) => { e.stopPropagation(); remove(e, conv.id); }} aria-label="Delete">×</button>
                  </div>
                </li>
              {/each}
            {/if}
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>

<style>
  .rail-icon-svg {
    width: 16px;
    height: 16px;
  }
  .rail-icon-labeled {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    width: 40px;
    padding: 3px 0;
    border-radius: 6px;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background 120ms, color 120ms, transform 120ms;
  }
  .rail-icon-labeled:hover {
    background: color-mix(in srgb, var(--ui-accent) 12%, transparent);
    transform: scale(1.05);
  }
  .rail-icon-labeled:active {
    transform: scale(0.95);
  }
  .rail-icon-labeled.rail-active {
    background: color-mix(in srgb, var(--ui-accent) 14%, transparent);
    border-left: 2px solid var(--ui-accent);
    border-radius: 3px 6px 6px 3px;
  }
  .rail-icon-label {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    line-height: 1;
    opacity: 0.9;
  }
</style>
