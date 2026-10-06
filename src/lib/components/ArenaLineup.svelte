<script>
  let {
    mode = 'anonymous',
    arena = 'text',
    quantity = 2,
    plan = '',
    status = '',
    onMode = (_mode) => {},
    onArena = (_id) => {},
    onQuantity = (_n) => {},
  } = $props();

  const fullNote = $derived([plan, status].filter(Boolean).join(' '));
  const shortNote = $derived.by(() => {
    const text = fullNote.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const cut = text.split('. ')[0].replace(/\.$/, '');
    return cut.length > 72 ? cut.slice(0, 69) + '…' : cut;
  });
</script>

<div
  class="arena-lineup shrink-0"
  
  title={fullNote}
>
  <div class="arena-lineup-group">
    <div class="arena-lineup-pills" role="group" aria-label="Contestant naming">
      <button type="button" class="arena-pill" aria-pressed={mode === 'anonymous'} onclick={() => onMode('anonymous')} title="Hide model names until the round ends">Anonymous</button>
      <button type="button" class="arena-pill" aria-pressed={mode === 'named'} onclick={() => onMode('named')} title="Pick each model by name in its column">Named</button>
    </div>
  </div>

  {#if mode !== 'named'}
    <div class="arena-lineup-group">
      <div class="arena-lineup-pills" role="group" aria-label="Arena type">
        {#each ['text', 'vision', 'code'] as id (id)}
          <button type="button" class="arena-pill" aria-pressed={arena === id} onclick={() => onArena(id)}>{id === 'text' ? 'Text' : id === 'vision' ? 'Vision' : 'Code'}</button>
        {/each}
      </div>
    </div>
    <div class="arena-lineup-group">
      <div class="arena-lineup-pills" role="group" aria-label="How many contestants">
        {#each [1, 2, 3, 4] as n (n)}
          <button type="button" class="arena-pill arena-pill-qty" aria-pressed={quantity === n} onclick={() => onQuantity(n)}>{n}</button>
        {/each}
      </div>
    </div>
  {/if}

  {#if shortNote}
    <span class="arena-lineup-note" role="status">{shortNote}</span>
  {/if}
</div>

<style>
  .arena-lineup {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 8px;
    min-height: 0;
    padding: 0 4px;
    overflow: hidden;
  }
  .arena-lineup-group {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
  }
  .arena-lineup-pills {
    display: flex;
    flex-wrap: nowrap;
    align-items: stretch;
    height: 28px;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    overflow: hidden;
    background: var(--ui-input-bg);
  }
  .arena-lineup-note {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-secondary);
  }
  .arena-pill {
    height: 28px;
    padding: 0 10px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--ui-text-secondary);
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
    cursor: pointer;
  }
  .arena-pill + .arena-pill {
    border-left: 1px solid var(--ui-border);
  }
  .arena-pill[aria-pressed="true"] {
    background: var(--ui-action, var(--ui-accent));
    color: var(--ui-action-ink, var(--ui-bg-main));
  }
  .arena-pill-qty {
    min-width: 28px;
    padding: 0 8px;
  }
</style>
