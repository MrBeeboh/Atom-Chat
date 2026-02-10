<script>
  import { isStreaming } from '../stores.js';

  let { onSend, onStop } = $props();
  let text = $state('');
  let textareaEl = $state(null);

  async function handleSubmit() {
    if (!text.trim() || $isStreaming) return;

    const userMessage = text.trim();
    text = '';

    if (onSend) await onSend(userMessage);
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 200) + 'px';
  }

  $effect(() => {
    text;
    if (textareaEl) return requestAnimationFrame(autoResize);
  });
</script>

<div class="chat-input-container">
  <textarea
    bind:this={textareaEl}
    bind:value={text}
    onkeydown={handleKeydown}
    oninput={autoResize}
    disabled={$isStreaming ? true : null}
    placeholder="Type your message... (Ctrl+Enter to send)"
    rows="1"
  ></textarea>

  {#if $isStreaming && onStop}
    <button type="button" class="send-button" style="background: var(--ui-accent-hot, #dc2626);" onclick={() => onStop()} title="Stop">Stop</button>
  {:else}
    <button
      onclick={handleSubmit}
      disabled={!text.trim() || $isStreaming ? true : null}
      class="send-button"
    >
      {#if $isStreaming}
        <span class="inline-flex items-center gap-1.5"><svg class="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Sending...</span>
      {:else}
        Send
      {/if}
    </button>
  {/if}
</div>

<style>
  .chat-input-container {
    display: flex;
    gap: 12px;
    padding: 16px;
    border-top: 1px solid var(--ui-border, #e5e7eb);
  }

  textarea {
    flex: 1;
    padding: 12px;
    border: 2px solid var(--ui-border, #e5e7eb);
    border-radius: 8px;
    font-family: inherit;
    font-size: 14px;
    resize: none;
    min-height: 44px;
    max-height: 200px;
    overflow-y: auto;
    background-color: var(--ui-input-bg, #fff);
    color: var(--ui-text-primary, #111);
  }

  textarea:focus {
    outline: none;
    border-color: var(--ui-accent, #3b82f6);
  }

  textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .send-button {
    padding: 12px 24px;
    min-height: 44px;
    background: var(--ui-accent, #3b82f6);
    color: var(--ui-bg-main, white);
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 150ms;
  }

  .send-button:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .send-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
</style>
