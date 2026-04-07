<script>
  import { tick } from 'svelte';
  import { activeMessages } from '$lib/stores.js';
  import MessageBubble from '$lib/components/MessageBubble.svelte';

  let listEl;

  $: msgs = $activeMessages;

  function scrollToBottom() {
    tick().then(() => {
      const scrollParent = listEl?.parentElement;
      if (scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight;
    });
  }

  $: msgs, scrollToBottom();
</script>

<div class="chat-message-list max-w-[min(52rem,92%)] mx-auto py-5 px-4 w-full" bind:this={listEl}>
  <div class="space-y-5">
    {#each msgs as msg (msg.id)}
      <div class="message-entrance">
        <MessageBubble message={msg} />
      </div>
    {/each}
  </div>
</div>
