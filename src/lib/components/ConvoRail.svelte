<script>
  import { onMount } from 'svelte';
  import { activeConversationId, conversations, layout, confirm } from '$lib/stores.js';
  import { listConversations, createConversation, deleteConversation, getMessageCount } from '$lib/db.js';
  import { bulkEraseChats } from '$lib/bulkEraseChats.js';
  import { groupByDate } from '$lib/utils.js';

  let expanded = $state(false);
  let convosList = $state([]);
  const groups = $derived(groupByDate(convosList));
  let activeId = $state(null);
  let layoutVal = $state('flow');

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
    if (!(await confirm({ title: 'Bulk erase', message: `Delete all ${n} conversation${n === 1 ? '' : 's'}? This cannot be undone.`, confirmLabel: 'Delete all', danger: true }))) return;
    await bulkEraseChats();
  }

  let tabBounce = $state(false);
  function toggleExpanded() {
    expanded = !expanded;
    tabBounce = true;
    const t = setTimeout(() => (tabBounce = false), 420);
    return () => clearTimeout(t);
  }
</script>

<div
  class="convo-rail flex flex-col shrink-0 border-r overflow-visible transition-[width] duration-200 relative"
  style="width: {expanded ? '200px' : '44px'}; background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);">
  <!-- Protruded arrow tab midway on right edge: out = expand, in = retract -->
  <button
    type="button"
    class="panel-tab {tabBounce ? 'panel-tab-bounce' : ''}"
    style="--panel-tab-transform: translate(100%, -50%); top: 50%; right: 0; border-left: none; border-radius: 0 6px 6px 0;"
    title={expanded ? 'Collapse ([)' : 'Expand ([)'}
    aria-label={expanded ? 'Collapse rail' : 'Expand rail'}
    onclick={toggleExpanded}>
    {#if expanded}
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
    {:else}
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
    {/if}
  </button>
  <button
    type="button"
    class="shrink-0 py-1.5 px-2 rounded mx-1 text-xs font-medium flex items-center justify-center gap-1"
    style="background: var(--ui-accent); color: var(--ui-bg-main);"
    onclick={newChat}
    title="New chat">
    + {#if expanded}New{/if}
  </button>
  {#if expanded && (convosList?.length ?? 0) > 0}
    <button
      type="button"
      class="shrink-0 py-1 px-2 rounded mx-1 text-[10px] border w-full text-left"
      style="color: var(--ui-text-secondary); border-color: var(--ui-border);"
      onclick={onBulkErase}
      title="Delete all conversations">
      Bulk erase all
    </button>
  {/if}
  <ul class="flex-1 overflow-y-auto mt-1 space-y-0.5 px-1 min-h-0">
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
          {#if expanded}
            <span class="truncate flex-1 text-xs min-w-0">{conv.title}</span>
            <button type="button" class="opacity-0 group-hover:opacity-100 p-0.5 rounded shrink-0 text-[10px] hover:bg-black/10" style="color: var(--ui-text-secondary);" onclick={(e) => { e.stopPropagation(); remove(e, conv.id); }} aria-label="Delete">×</button>
          {:else}
            <span class="w-5 h-5 shrink-0 rounded flex items-center justify-center text-[10px] font-medium bg-zinc-500/30">{conv.title ? conv.title[0].toUpperCase() : '?'}</span>
          {/if}
        </div>
      </li>
        {/each}
      {/if}
    {/each}
  </ul>
</div>
