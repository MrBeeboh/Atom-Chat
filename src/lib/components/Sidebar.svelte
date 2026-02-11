<!--
  Sidebar: conversation list (+ New, Settings, Bulk erase), grouped by date. Uses confirm() before delete/bulk erase.
-->
<script>
  import { onMount } from 'svelte';
  import { activeConversationId, conversations, sidebarOpen, settingsOpen, confirm } from '$lib/stores.js';
  import { listConversations, createConversation, deleteConversation, getMessageCount } from '$lib/db.js';
  import { bulkEraseChats } from '$lib/bulkEraseChats.js';
  import { formatTime, groupByDate } from '$lib/utils.js';
  import { getModelIcon, modelIconOverrides } from '$lib/modelIcons.js';

  const groups = $derived(groupByDate($conversations));

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
    if (!$activeConversationId) activeConversationId.set(list[0].id);
  }

  onMount(loadConversations);

  async function newChat() {
    const id = await createConversation();
    await loadConversations();
    activeConversationId.set(id);
  }

  async function select(id) {
    activeConversationId.set(id);
    sidebarOpen.set(false);
  }

  async function remove(ev, id) {
    ev.stopPropagation();
    if (!(await confirm({ title: 'Delete conversation', message: 'Delete this conversation?' }))) return;
    await deleteConversation(id);
    if ($activeConversationId === id) activeConversationId.set(null);
    await loadConversations();
  }

  async function onBulkErase() {
    const n = $conversations?.length ?? 0;
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
</script>

<div class="flex-1 overflow-y-auto overflow-x-hidden p-2 flex flex-col min-h-0 min-w-0">
  <button
    type="button"
    class="w-full min-w-0 py-2.5 px-3 rounded-lg text-left font-medium text-xs transition-opacity hover:opacity-90 shrink-0"
    style="background: var(--ui-accent); color: var(--ui-bg-main);"
    onclick={newChat}>
    + New chat
  </button>
  <button
    type="button"
    class="w-full min-w-0 mt-1.5 py-1.5 px-3 rounded-lg text-left text-xs transition-opacity hover:opacity-90 shrink-0 border flex items-center gap-2"
    style="color: var(--ui-text-secondary); border-color: var(--ui-border);"
    onclick={() => { settingsOpen.set(true); sidebarOpen.set(false); }}
    title="LM Studio URL, Voice server, Audio, Presets">
    <span class="text-base shrink-0">⚙</span> Settings
  </button>
  {#if ($conversations?.length ?? 0) > 0}
    <button
      type="button"
      class="bulk-erase-link mt-1.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 shrink-0 flex items-center gap-1.5"
      style="color: var(--ui-accent-hot, #dc2626); background: none; border: none;"
      onclick={onBulkErase}
      title="Permanently delete all conversations (you will be asked to confirm)">
      <span aria-hidden="true">⚠</span>
      Bulk erase all chats
    </button>
  {/if}
  <ul class="mt-2 space-y-0.5 flex-1 min-h-0 overflow-y-auto">
    {#each ['today', 'yesterday', 'week', 'older'] as key}
      {#if groups[key]?.length > 0}
        <li class="px-2 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider" style="color: var(--ui-text-secondary);">{key === 'today' ? 'Today' : key === 'yesterday' ? 'Yesterday' : key === 'week' ? 'This week' : 'Older'}</li>
        {#each groups[key] as conv}
      {@const icon = conv.model ? getModelIcon(conv.model, $modelIconOverrides) : null}
      {@const isActive = $activeConversationId === conv.id}
      <li>
        <div
          role="button"
          tabindex="0"
          class="w-full text-left py-1.5 px-2 rounded-lg flex items-center gap-2 cursor-pointer transition-colors group rounded-l-none {isActive ? 'ui-sidebar-active' : ''}"
          style:background={isActive ? 'var(--ui-sidebar-active)' : 'transparent'}
          style:color={isActive ? 'var(--ui-text-primary)' : 'var(--ui-text-secondary)'}
          onclick={() => select(conv.id)}
          onkeydown={(e) => e.key === 'Enter' && select(conv.id)}>
          {#if icon}
            <img src={icon} alt="" class="w-4 h-4 shrink-0 rounded object-contain opacity-80" />
          {/if}
          <span class="truncate flex-1 text-xs min-w-0">{conv.title}</span>
          <span class="text-[10px] shrink-0 font-mono opacity-80">{conv.messageCount ?? 0}</span>
          <span class="text-[10px] shrink-0 opacity-80">{formatTime(conv.updatedAt)}</span>
          <button
            type="button"
            class="opacity-0 group-hover:opacity-100 p-1 rounded text-[10px] shrink-0 transition-opacity hover:opacity-100"
            style="color: var(--ui-accent-hot);"
            onclick={(e) => remove(e, conv.id)}
            aria-label="Delete">×</button>
        </div>
      </li>
        {/each}
      {/if}
    {/each}
  </ul>
</div>
