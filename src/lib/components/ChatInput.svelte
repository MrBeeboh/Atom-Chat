<script>
  import { get } from 'svelte/store';
  import { isStreaming, voiceServerUrl, pendingDroppedFiles, webSearchForNextMessage, webSearchInProgress, webSearchConnected } from '$lib/stores.js';
  import ThinkingAtom from '$lib/components/ThinkingAtom.svelte';
  import { warmUpSearchConnection } from '$lib/duckduckgo.js';
  import { pdfToImageDataUrls } from '$lib/pdfToImages.js';
  import { videoToFrames } from '$lib/videoToFrames.js';

  let { onSend, onStop, placeholder: placeholderOverride = undefined } = $props();
  const placeholderText = $derived(placeholderOverride ?? 'Type your message or drop/paste images, video, or PDFs... (Ctrl+Enter to send)');
  let text = $state('');
  let textareaEl = $state(null);
  let fileInputEl = $state(/** @type {HTMLInputElement | null} */ (null));
  let recording = $state(false);
  let voiceProcessing = $state(false);
  let voiceError = $state(null);
  let mediaRecorder = $state(null);
  let voiceStream = $state(null); // so we can release mic immediately on stop
  let recordingChunks = $state([]);
  let recordingStartMs = $state(0);
  const MAX_RECORDING_MS = 90_000; // 90 s cap
  let recordingTimerId = $state(null);

  /** True while warming up web search connection (right after user turns on globe or when enabled via Command Palette). */
  let webSearchWarmingUp = $state(false);

  /** So we only auto-start warm-up once per "web search on"; avoid retry loop when warm-up fails. */
  let webSearchWarmUpAttempted = $state(false);

  /** When web search is turned on from anywhere (globe or Command Palette), start warm-up so globe behavior is the same in all layouts. */
  $effect(() => {
    const on = get(webSearchForNextMessage);
    const connected = get(webSearchConnected);
    if (!on) {
      webSearchWarmUpAttempted = false;
      return;
    }
    if (connected || webSearchWarmingUp || webSearchWarmUpAttempted) return;
    webSearchWarmUpAttempted = true;
    webSearchWarmingUp = true;
    warmUpSearchConnection().then((ok) => {
      webSearchWarmingUp = false;
      if (ok) webSearchConnected.set(true);
    });
  });

  /** Attachments: { dataUrl, label } for display; we send dataUrl list to onSend. */
  let attachments = $state([]);
  let attachProcessing = $state(false);
  let attachError = $state(null);
  const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/gif';
  const ACCEPT_PDF = 'application/pdf';
  const ACCEPT_VIDEO = 'video/mp4,video/webm,video/quicktime';
  const MAX_FILE_MB = 25;
  const MAX_VIDEO_MB = 100;
  const MAX_TOTAL_MB = 80;

  async function handleSubmit() {
    if ($isStreaming) return;
    const userMessage = (text || '').trim();
    const imageDataUrls = attachments.map((a) => a.dataUrl);
    if (!userMessage && imageDataUrls.length === 0) return;

    text = '';
    attachments = [];
    attachError = null;

    if (onSend) await onSend(userMessage, imageDataUrls);
  }

  function addImageDataUrls(dataUrls, label) {
    for (const url of dataUrls) {
      attachments = [...attachments, { dataUrl: url, label: label || 'Image' }];
    }
  }

  async function processFiles(files) {
    if (!files?.length) return;
    attachError = null;
    attachProcessing = true;
    let totalMb = attachments.reduce((sum, a) => sum + (a.dataUrl.length * 3 / 4 / 1024 / 1024), 0);

    try {
      for (const file of Array.from(files)) {
        const fileMb = file.size / 1024 / 1024;
        const type = (file.type || '').toLowerCase();
        const limitMb = type.startsWith('video/') ? MAX_VIDEO_MB : MAX_FILE_MB;
        if (fileMb > limitMb) {
          attachError = `"${file.name}" is too large (max ${limitMb} MB).`;
          continue;
        }
        if (totalMb + fileMb > MAX_TOTAL_MB) {
          attachError = `Total attachments over ${MAX_TOTAL_MB} MB.`;
          break;
        }

        if (type === 'application/pdf') {
          const urls = await pdfToImageDataUrls(file);
          if (urls.length === 0) {
            attachError = `Could not read PDF "${file.name}".`;
            continue;
          }
          urls.forEach((url, i) => addImageDataUrls([url], urls.length > 1 ? `${file.name} (p.${i + 1})` : file.name));
          totalMb += (urls[0].length * 3 / 4 / 1024 / 1024) * urls.length;
        } else if (type.startsWith('image/')) {
          const url = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error('Failed to read file'));
            r.readAsDataURL(file);
          });
          addImageDataUrls([url], file.name);
          totalMb += fileMb;
        } else if (type.startsWith('video/')) {
          try {
            const urls = await videoToFrames(file, { count: 8, maxDurationSec: 60 });
            if (urls.length === 0) {
              attachError = `Could not extract frames from "${file.name}".`;
              continue;
            }
            addImageDataUrls(urls, `${file.name} (${urls.length} frames)`);
            totalMb += urls.reduce((sum, u) => sum + (u.length * 3 / 4 / 1024 / 1024), 0);
          } catch (e) {
            attachError = e?.message || `Could not read video "${file.name}".`;
          }
        } else {
          attachError = `Unsupported: ${file.name}. Use images (JPEG, PNG, WebP, GIF), video (MP4, WebM), or PDF.`;
        }
      }
    } catch (e) {
      attachError = e?.message || 'Failed to add file(s).';
    } finally {
      attachProcessing = false;
    }
  }

  function onFileInputChange(e) {
    const input = e.currentTarget;
    processFiles(input.files);
    input.value = '';
  }

  function removeAttachment(index) {
    attachments = attachments.filter((_, i) => i !== index);
    attachError = null;
  }

  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    processFiles(e.dataTransfer?.files);
  }

  function onDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onPaste(e) {
    const files = e.clipboardData?.files;
    if (files?.length) {
      e.preventDefault();
      processFiles(files);
    }
  }

  $effect(() => {
    const unsub = pendingDroppedFiles.subscribe((files) => {
      if (files?.length) {
        pendingDroppedFiles.set(null);
        processFiles(files);
      }
    });
    return () => { unsub(); };
  });

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
    if (textareaEl) {
      const id = requestAnimationFrame(autoResize);
      return () => cancelAnimationFrame(id);
    }
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

<div
  class="chat-input-container"
  ondragover={onDragOver}
  ondrop={onDrop}
  role="presentation"
>
  <input
    bind:this={fileInputEl}
    type="file"
    accept="{ACCEPT_IMAGE},{ACCEPT_PDF},{ACCEPT_VIDEO}"
    multiple
    class="hidden-file-input"
    onchange={onFileInputChange}
    aria-label="Attach image or PDF"
  />
  <button
    type="button"
    class="attach-button"
    title="Attach image or PDF (or drag & drop, paste)"
    disabled={$isStreaming || attachProcessing}
    onclick={() => fileInputEl?.click()}
    aria-label="Attach files"
  >
    {#if attachProcessing}
      <span class="mic-spinner" aria-hidden="true">⟳</span>
    {:else}
      <span aria-hidden="true">📎</span>
    {/if}
  </button>
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
  <button
    type="button"
    class="web-search-button"
    class:active={$webSearchForNextMessage}
    title={webSearchWarmingUp ? 'Connecting…' : $webSearchForNextMessage ? ($webSearchConnected ? 'Web search on – connected (click to turn off)' : 'Web search on – not connected yet (click globe again to retry)') : 'Search the web for next message'}
    disabled={$isStreaming}
    onclick={() => {
      const next = !$webSearchForNextMessage;
      webSearchForNextMessage.set(next);
      if (!next) {
        webSearchConnected.set(false);
        return;
      }
      webSearchConnected.set(false);
      /* Warm-up is started by $effect when webSearchForNextMessage becomes true (same for globe click or Command Palette). */
    }}
    aria-label={webSearchWarmingUp ? 'Connecting' : $webSearchForNextMessage ? 'Web search on' : 'Search web for next message'}
    aria-pressed={$webSearchForNextMessage}
    aria-busy={webSearchWarmingUp}
  >
    <span
      class="web-search-icon"
      class:web-search-icon-spin={webSearchWarmingUp}
      aria-hidden="true"
      title="Internet"
    >🌐</span>
    {#if $webSearchForNextMessage}
      {#if $webSearchConnected}
        <span class="web-search-dot web-search-dot-green" aria-hidden="true" title="Connected"></span>
      {:else}
        <span class="web-search-dot web-search-dot-red" class:web-search-dot-pulse={webSearchWarmingUp} aria-hidden="true" title="Not connected"></span>
      {/if}
    {/if}
  </button>
  <div class="chat-input-main">
    {#if attachments.length > 0}
      <div class="attachments-row">
        {#each attachments as att, i}
          <div class="attachment-thumb">
            {#if att.dataUrl.startsWith('data:image')}
              <img src={att.dataUrl} alt="" class="thumb-img" />
            {:else}
              <span class="thumb-placeholder">IMG</span>
            {/if}
            <span class="thumb-label" title={att.label}>{att.label.length > 12 ? att.label.slice(0, 10) + '…' : att.label}</span>
            <button type="button" class="thumb-remove" onclick={() => removeAttachment(i)} aria-label="Remove">×</button>
          </div>
        {/each}
      </div>
    {/if}
    <textarea
      bind:this={textareaEl}
      bind:value={text}
      onkeydown={handleKeydown}
      oninput={autoResize}
      onpaste={onPaste}
      disabled={$isStreaming ? true : null}
      placeholder={placeholderText}
      rows="1"
    ></textarea>
  </div>

  {#if $isStreaming && onStop}
    <button type="button" class="send-button" style="background: var(--ui-accent-hot, #dc2626);" onclick={() => onStop()} title="Stop">Stop</button>
  {:else}
    <button
      onclick={handleSubmit}
      disabled={($isStreaming || $webSearchInProgress || (!text.trim() && attachments.length === 0)) ? true : null}
      class="send-button"
    >
      {#if $webSearchInProgress}
        <span class="inline-flex items-center gap-1.5"><ThinkingAtom size={16} />Searching…</span>
      {:else if $isStreaming}
        <span class="inline-flex items-center gap-1.5"><ThinkingAtom size={16} />Sending...</span>
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
  {#if attachError}
    <p class="attach-error" role="alert">{attachError}</p>
  {/if}
</div>

<style>
  .chat-input-container {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
  }

  .chat-input-container > .attach-button,
  .chat-input-container > .mic-button,
  .chat-input-container > .web-search-button,
  .chat-input-container > .send-button {
    flex-shrink: 0;
    height: 44px;
    min-height: 44px;
    align-self: flex-start;
  }

  textarea {
    flex: 1;
    padding: 12px;
    border: 2px solid var(--ui-border, #e5e7eb);
    border-radius: 8px;
    font-family: inherit;
    font-size: 14px;
    resize: none;
    min-height: 60px;
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
  .voice-error,
  .attach-error {
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
  .hidden-file-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }
  .attach-button {
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
  .attach-button:hover:not(:disabled) {
    border-color: var(--ui-accent, #3b82f6);
    background: color-mix(in srgb, var(--ui-accent, #3b82f6) 10%, transparent);
  }
  .attach-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .web-search-button {
    position: relative;
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
    transition: border-color 0.15s, background 0.15s;
  }
  .web-search-button:hover:not(:disabled) {
    border-color: var(--ui-accent, #3b82f6);
    background: color-mix(in srgb, var(--ui-accent, #3b82f6) 10%, transparent);
  }
  .web-search-button.active {
    border-color: var(--ui-accent, #3b82f6);
    background: color-mix(in srgb, var(--ui-accent, #3b82f6) 14%, transparent);
  }
  .web-search-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .web-search-icon {
    font-size: 1.25rem;
    line-height: 1;
  }
  .web-search-icon-spin {
    animation: web-search-globe-spin 1.2s linear infinite;
  }
  @keyframes web-search-globe-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .web-search-dot {
    position: absolute;
    bottom: 5px;
    left: 5px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    pointer-events: none;
  }
  .web-search-dot-green {
    background: #22c55e;
  }
  .web-search-dot-red {
    background: #dc2626;
  }
  .web-search-dot-pulse {
    animation: web-search-dot-pulse 1.2s ease-in-out infinite;
  }
  @keyframes web-search-dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .chat-input-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .attachments-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
  }
  .attachment-thumb {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--ui-border, #e5e7eb);
    background: var(--ui-bg-main);
    flex-shrink: 0;
  }
  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    color: var(--ui-text-secondary);
    background: var(--ui-input-bg);
  }
  .thumb-label {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 4px;
    font-size: 9px;
    background: rgba(0,0,0,0.6);
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .thumb-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: rgba(0,0,0,0.6);
    color: #fff;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .thumb-remove:hover {
    background: var(--ui-accent-hot, #dc2626);
  }
</style>
