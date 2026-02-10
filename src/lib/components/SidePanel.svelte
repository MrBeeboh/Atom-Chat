<script>
  import { fly } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';

  let {
    title = 'Panel',
    icon = '☰',
    position = 'right',
    openStore,
    width = '320px',
    triggerTitle = '',
    children,
  } = $props();

  const slideDistance = typeof width === 'number' ? width : 320;
  const x = position === 'right' ? slideDistance : -slideDistance;
</script>

{#if !$openStore}
  <button
    type="button"
    class="side-panel-trigger"
    style="
      {position === 'right' ? 'right: 16px;' : 'left: 16px;'}
      top: 60px;
    "
    onclick={() => openStore.set(true)}
    title={triggerTitle || `Open ${title}`}
    aria-label={triggerTitle || `Open ${title}`}
  >
    {icon}
  </button>
{/if}

{#if $openStore}
  <aside
    class="side-panel"
    class:left={position === 'left'}
    class:right={position === 'right'}
    style="width: {typeof width === 'number' ? width + 'px' : width};"
    role="dialog"
    aria-label={title}
    in:fly={{ x, duration: 400, easing: backOut }}
    out:fly={{ x, duration: 300, easing: quintOut }}
  >
    <header class="side-panel-header">
      <h3 class="side-panel-title">{title}</h3>
      <button
        type="button"
        class="side-panel-close"
        onclick={() => openStore.set(false)}
        title="Close"
        aria-label="Close"
      >
        ✕
      </button>
    </header>
    <div class="side-panel-body">
      {@render children?.()}
    </div>
  </aside>
{/if}

<style>
  .side-panel-trigger {
    position: fixed;
    z-index: 45;
    padding: 10px 12px;
    font-size: 1.25rem;
    line-height: 1;
    border: 2px solid var(--ui-border);
    border-radius: 8px;
    background-color: var(--ui-bg-sidebar);
    color: var(--ui-text-secondary);
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s;
  }
  .side-panel-trigger:hover {
    color: var(--ui-text-primary);
    background-color: var(--ui-bg-primary);
  }

  .side-panel {
    position: fixed;
    top: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    background-color: var(--ui-bg-primary);
    border: 2px solid var(--ui-border);
    box-shadow: -4px 0 12px rgba(0, 0, 0, 0.15);
  }
  .side-panel.right {
    right: 0;
  }
  .side-panel.left {
    left: 0;
  }

  .side-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ui-border);
    flex-shrink: 0;
  }
  .side-panel-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ui-text-primary);
  }
  .side-panel-close {
    padding: 4px 8px;
    font-size: 1.25rem;
    line-height: 1;
    background: none;
    border: none;
    color: var(--ui-text-secondary);
    cursor: pointer;
    border-radius: 4px;
    transition: color 0.15s, background-color 0.15s;
  }
  .side-panel-close:hover {
    color: var(--ui-text-primary);
    background-color: color-mix(in srgb, var(--ui-border) 30%, transparent);
  }

  .side-panel-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
</style>
