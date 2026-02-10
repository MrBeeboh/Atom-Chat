<script>
  import { get } from 'svelte/store';
  import { isStreaming, voiceServerUrl } from '$lib/stores.js';

  let { onSend, onStop } = $props();
  let text = $state('');
  let textareaEl = $state(null);
  let recording = $state(false);
  let voiceProcessing = $state(false);
  let voiceError = $state(null);
  let mediaRecorder = $state(null);
  let voiceStream = $state(null); // so we can release mic immediately on stop
  let recordingChunks = $state([]);
  let recordingStartMs = $state(0);
  const MAX_RECORDING_MS = 90_000; // 90 s cap
  let recordingTimerId = $state(null);

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

  function stopRecording() {
    if (recordingTimerId != null) {
      clearTimeout(recordingTimerId);
      recordingTimerId = null;
    }
    // Release microphone immediately so the tab mic indicator goes away
    if (voiceStream) {
      voiceStream.getTracks().forEach((t) => t.stop());
      voiceStream = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    recording = false;
  }

  async function startVoiceInput() {
    const baseUrl = get(voiceServerUrl) ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('voiceServerUrl') : null) ?? 'http://localhost:8765';
    const url = (baseUrl || '').trim().replace(/\/$/, '');
    if (!url) {
      voiceError = 'Set Voice server URL in Settings (e.g. http://localhost:8765)';
      return;
    }
    voiceError = null;
    try {
      // Check server is up before grabbing the mic
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 3000);
      let healthRes;
      try {
        healthRes = await fetch(`${url}/health`, { method: 'GET', signal: ac.signal });
      } catch (he) {
        clearTimeout(to);
        voiceError = `Voice server not running at ${url}. Start it: cd voice-server && uvicorn app:app --port 8765`;
        return;
      }
      clearTimeout(to);
      if (!healthRes.ok) {
        voiceError = `Voice server at ${url} returned ${healthRes.status}. Start it: cd voice-server && uvicorn app:app --port 8765`;
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStream = stream;
      recordingChunks = [];
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorder = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) recordingChunks.push(e.data); };
      rec.onstop = async () => {
        if (voiceStream) {
          voiceStream.getTracks().forEach((t) => t.stop());
          voiceStream = null;
        }
        if (recordingChunks.length === 0) {
          voiceError = 'No audio recorded';
          voiceProcessing = false;
          return;
        }
        const blob = new Blob(recordingChunks, { type: 'audio/webm' });
        try {
          const form = new FormData();
          form.append('audio', blob, 'audio.webm');
          const res = await fetch(`${url}/transcribe`, { method: 'POST', body: form });
          if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `Server ${res.status}`);
          }
          const data = await res.json();
          const transcribed = (data && data.text) ? String(data.text).trim() : '';
          if (transcribed) text = text ? text + ' ' + transcribed : transcribed;
        } catch (e) {
          voiceError = e?.message || 'Voice server error. Is it running on ' + url + '?';
        } finally {
          voiceProcessing = false;
        }
      };
      rec.start(1000);
      recording = true;
      recordingStartMs = Date.now();
      voiceProcessing = true;
      recordingTimerId = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch (e) {
      voiceError = e?.message || 'Microphone access denied or unavailable';
    }
  }

  function toggleVoice() {
    // Always allow clicking to stop recording (don't block on voiceProcessing)
    if (recording) {
      stopRecording();
      return;
    }
    if (voiceProcessing) return; // still uploading/transcribing
    startVoiceInput();
  }
</script>

<div class="chat-input-container">
  <button
    type="button"
    class="mic-button"
    title={recording ? 'Stop recording (click again)' : 'Voice input – start Python server first'}
    disabled={$isStreaming || (voiceProcessing && !recording)}
    onclick={toggleVoice}
    aria-label={recording ? 'Stop recording' : 'Start voice input'}
  >
    {#if voiceProcessing && !recording}
      <span class="mic-spinner" aria-hidden="true">⟳</span>
    {:else if recording}
      <span class="mic-dot" aria-hidden="true"></span>
    {:else}
      <span class="mic-icon" aria-hidden="true">🎤</span>
    {/if}
  </button>
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
  {#if recording}
    <span class="voice-recording-hint">Recording – click mic to stop</span>
  {/if}
  {#if voiceError}
    <p class="voice-error" role="alert">{voiceError}</p>
  {/if}
</div>

<style>
  .chat-input-container {
    position: relative;
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

  .mic-button {
    flex-shrink: 0;
    width: 44px;
    min-height: 44px;
    border-radius: 8px;
    border: 2px solid var(--ui-border, #e5e7eb);
    background: var(--ui-input-bg, #fff);
    color: var(--ui-text-primary, #111);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    transition: all 150ms;
  }
  .mic-button:hover:not(:disabled) {
    border-color: var(--ui-accent, #3b82f6);
    background: color-mix(in srgb, var(--ui-accent, #3b82f6) 10%, transparent);
  }
  .mic-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mic-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--ui-accent-hot, #dc2626);
    animation: pulse 1s ease-in-out infinite;
  }
  .mic-spinner {
    animation: spin 0.8s linear infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .voice-recording-hint {
    font-size: 12px;
    color: var(--ui-text-secondary, #6b7280);
    align-self: center;
  }
  .voice-error {
    position: absolute;
    bottom: 100%;
    left: 16px;
    right: 80px;
    margin: 0 0 4px 0;
    padding: 6px 10px;
    font-size: 12px;
    border-radius: 6px;
    background: color-mix(in srgb, #dc2626 15%, var(--ui-bg-main));
    color: var(--ui-text-primary);
    border: 1px solid var(--ui-accent-hot, #dc2626);
  }
</style>
