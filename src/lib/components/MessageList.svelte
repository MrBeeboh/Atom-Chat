<script>
  import { tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { activeMessages } from '$lib/stores.js';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import ScrollToBottomButton from '$lib/components/ScrollToBottomButton.svelte';

  let { onRegenerate = null, onEditResend = null, onDelete = null } = $props();

  let listEl = $state(/** @type {HTMLDivElement | null} */ (null));
  let scrollRoot = $state(/** @type {HTMLElement | null} */ (null));

  let msgs = $derived($activeMessages);

  function scrollToBottom(smooth = false) {
    tick().then(() => {
      const parent = scrollRoot ?? listEl?.parentElement;
      if (!parent) return;
      if (smooth) {
        parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
      } else {
        parent.scrollTop = parent.scrollHeight;
      }
    });
  }

  $effect(() => {
    msgs;
    scrollToBottom(false);
  });

  $effect(() => {
    scrollRoot = listEl?.parentElement ?? null;
  });
</script>

<ScrollToBottomButton {scrollRoot} />
<div class="chat-message-list max-w-[min(52rem,92%)] mx-auto py-4 md:py-5 px-3 md:px-4 w-full" bind:this={listEl}>
  <div class="space-y-4 md:space-y-5">
    {#each msgs as msg, i (msg.id)}
      <div class="message-entrance" in:fly={{ y: 16, duration: 400, easing: quintOut }}>
        <MessageBubble message={msg} isLast={i === msgs.length - 1} {onRegenerate} {onEditResend} {onDelete} />
      </div>
    {/each}
  </div>
</div>
