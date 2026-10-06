<script>
  /** @type {HTMLElement | null} */
  let { scrollRoot = null } = $props();

  let visible = $state(false);

  function updateVisibility() {
    const el = scrollRoot;
    if (!el) {
      visible = false;
      return;
    }
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    visible = dist > 100;
  }

  function scrollDown() {
    scrollRoot?.scrollTo({ top: scrollRoot.scrollHeight, behavior: 'smooth' });
  }

  $effect(() => {
    const el = scrollRoot;
    if (!el) return;
    updateVisibility();
    el.addEventListener('scroll', updateVisibility, { passive: true });
    const ro = new ResizeObserver(updateVisibility);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateVisibility);
      ro.disconnect();
    };
  });
</script>

{#if visible}
  <button
    type="button"
    class="scroll-to-bottom-btn"
    onclick={scrollDown}
    aria-label="Scroll to latest message"
    title="Jump to latest"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M12 5v14M5 12l7 7 7-7" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
{/if}