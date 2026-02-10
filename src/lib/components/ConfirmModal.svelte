<script>
  import { fade } from 'svelte/transition';
  import { confirmStore } from '$lib/stores.js';

  let pending = $state(null);

  $effect(() => {
    const unsub = confirmStore.subscribe((v) => (pending = v));
    return () => unsub();
  });

  function onConfirm() {
    if (pending?.resolve) pending.resolve(true);
    confirmStore.set(null);
  }
  function onCancel() {
    if (pending?.resolve) pending.resolve(false);
    confirmStore.set(null);
  }
</script>

{#if pending}
  <div
    class="fixed inset-0 z-[200] flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="confirm-title"
    transition:fade={{ duration: 150 }}
  >
    <div
      class="absolute inset-0 bg-black/50"
      onclick={onCancel}
    ></div>
    <div
      class="relative rounded-xl border shadow-xl max-w-md w-full p-4"
      style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 id="confirm-title" class="text-base font-semibold mb-2" style="color: var(--ui-text-primary);">{pending.title}</h2>
      <p class="text-sm mb-4" style="color: var(--ui-text-secondary);">{pending.message}</p>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] transition-colors"
          style="color: var(--ui-text-secondary); border: 1px solid var(--ui-border);"
          onclick={onCancel}
        >{pending.cancelLabel}</button>
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] transition-colors"
          style:background={pending.danger ? 'var(--ui-accent-hot, #dc2626)' : 'var(--ui-accent)'}
          style:color="white"
          onclick={onConfirm}
        >{pending.confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}
