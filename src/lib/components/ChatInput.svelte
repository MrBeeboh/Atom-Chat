<script>
  import { isStreaming } from '../stores.js';

  let { onSend, onStop } = $props();
  let text = $state('');

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
</script>

<div class="chat-input-container">
  <textarea
    bind:value={text}
    onkeydown={handleKeydown}
    disabled={$isStreaming ? true : null}
    placeholder="Type your message... (Ctrl+Enter to send)"
    rows="3"></textarea>

  {#if $isStreaming && onStop}
    <button type="button" class="send-button" style="background: var(--ui-accent-hot, #dc2626);" onclick={() => onStop()} title="Stop">Stop</button>
  {:else}
    <button
      onclick={handleSubmit}
      disabled={!text.trim() || $isStreaming ? true : null}
      class="send-button"
    >
      {#if $isStreaming}
        Sending...
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
    resize: vertical;
    min-height: 60px;
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
