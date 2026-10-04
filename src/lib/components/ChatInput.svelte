<script>
  import { get } from 'svelte/store';
  import { tick, onMount } from 'svelte';
  import { isStreaming, voiceServerUrl, micDeviceId, pendingDroppedFiles, insertChatPrompt, webSearchForNextMessage, webSearchInProgress, webSearchConnected, layout, braveApiKey, openMicActive, ttsReadAloudEnabled, ttsActiveMessageId, ttsPreparing, ttsError, ttsVolume, voiceRoleplaySessionActive, settingsOpen, settingsFocus, ttsEngine, effectiveModelId, settings, setPerModelOverride } from '$lib/stores.js';
  import ThinkingAtom from '$lib/components/ThinkingAtom.svelte';
  import ThinkingControls from '$lib/components/ThinkingControls.svelte';
  import ContextRing from '$lib/components/ContextRing.svelte';
  import { COCKPIT_SENDING, COCKPIT_SEARCHING, pickWitty } from '$lib/cockpitCopy.js';
  import { warmUpSearchConnection, syncBraveKeyToProxy } from '$lib/duckduckgo.js';
  import { pdfToImageDataUrls } from '$lib/pdfToImages.js';
  import { videoToFrames } from '$lib/videoToFrames.js';
  import { isUsefulTranscript, recordUntilSilence, sleep, waitUntilReplySpoken } from '$lib/openMic.js';
  import { acquireMicStream, createMediaRecorder, micErrorMessage } from '$lib/micAccess.js';
  import { isTtsBusy, stopTts, warmUpKokoroTts, unlockAudioPlayback } from '$lib/tts.js';
  import { resolveVoiceServerUrl, checkVoiceServerHealth, transcribeBlob, estimateDataUrlMb } from '$lib/voiceInput.js';
  import { autoResizeTextarea } from '$lib/autoResize.js';

  let { onSend, onStop, onGenerateImageGrok, onGenerateImageDeepSeek, onGenerateVideoDeepSeek, imageGenerating = false, videoGenerating = false, videoGenElapsed = '', placeholder: placeholderOverride = undefined } = $props();
  const placeholderText = $derived(
    placeholderOverride ?? 'Message ATOM… drop files or paste images',
  );
  const sendHint = $derived(
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      ? '↵ send · ⇧↵ new line'
      : 'Enter send · Shift+Enter new line',
  );
  let text = $state('');
  let textareaEl = $state(null);
  let fileInputEl = $state(/** @type {HTMLInputElement | null} */ (null));
  let recording = $state(false);
  let voiceProcessing = $state(false);
  let voiceError = $state(null);
  const VOICE_OFFLINE = 'Voice server offline. Start ATOM from the desktop icon.';
  let mediaRecorder = $state(null);
  let voiceStream = $state(null); // so we can release mic immediately on stop
  let recordingChunks = $state([]);
  let recordingStartMs = $state(0);
  const MAX_RECORDING_MS = 90_000; // 90 s cap
  let recordingTimerId = $state(null);

  /** Hands-free loop: listen → send → TTS → listen again. */
  let openMic = $state(false);
  /** @type {'idle' | 'listening' | 'transcribing' | 'waiting' | 'speaking'} */
  let openMicPhase = $state('idle');
  let openMicGen = 0;

  /** True while warming up web search connection (right after user turns on globe or when enabled via Command Palette). */
  let webSearchWarmingUp = $state(false);

  /** So we only auto-start warm-up once per "web search on"; avoid retry loop when warm-up fails. */
  let webSearchWarmUpAttempted = $state(false);

  /** Witty status lines for send button (set when streaming/searching starts). */
  let sendingMessage = $state('');
  let searchingMessage = $state('');
  $effect(() => {
    if ($isStreaming) sendingMessage = pickWitty(COCKPIT_SENDING);
  });
  $effect(() => {
    if ($webSearchInProgress) searchingMessage = pickWitty(COCKPIT_SEARCHING);
  });

  /** Ready to send: has text or attachments. Used for Send button "ready" state. */
  const canSend = $derived(!!(text.trim() || attachments.length));
  const ttsSpeaking = $derived(!!$ttsActiveMessageId || $ttsPreparing);

  function toggleReadAloud() {
    if (get(voiceRoleplaySessionActive)) return;
    const next = !get(ttsReadAloudEnabled);
    if (next) unlockAudioPlayback();
    ttsReadAloudEnabled.set(next);
    ttsError.set(null);
    if (next && get(ttsEngine) === 'kokoro') warmUpKokoroTts();
    if (!next) {
      stopTts();
      ttsActiveMessageId.set(null);
    }
  }

  function onThinkingChange(patch) {
    const id = get(effectiveModelId);
    if (id) setPerModelOverride(id, patch);
  }

  function onReadAloudClick(e) {
    if (e.shiftKey) {
      settingsFocus.set('read-aloud');
      settingsOpen.set(true);
      return;
    }
    toggleReadAloud();
  }

  let volumeOpen = $state(false);
  let volumeWrapEl = $state(/** @type {HTMLElement | null} */ (null));
  const volumePct = $derived(Math.round(($ttsVolume ?? 0.8) * 100));

  function onVolumeClick() {
    if (($ttsVolume ?? 0) <= 0.001) {
      ttsVolume.set(0.8);
      volumeOpen = true;
      return;
    }
    volumeOpen = !volumeOpen;
  }

  $effect(() => {
    if (!volumeOpen) return;
    function onDoc(e) {
      if (volumeWrapEl && !volumeWrapEl.contains(/** @type {Node} */ (e.target))) volumeOpen = false;
    }
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  });
  /** Brief "sending" state for bar animation when user hits Send. */
  let sending = $state(false);
  /** Brief success feedback (checkmark) after send. */
  let justSent = $state(false);
  /** Brief error feedback if send throws. */
  let sendError = $state(false);
  let justSentTimeoutId = $state(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  let sendErrorTimeoutId = $state(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

  /** Start (or retry) web-search warm-up: spin the globe, hit CORS proxy, set green/red dot. */
  function runWarmUp() {
    webSearchWarmUpAttempted = true;
    webSearchWarmingUp = true;
    webSearchConnected.set(false);
    warmUpSearchConnection()
      .then((ok) => {
        if (!ok && get(braveApiKey)?.trim()) return syncBraveKeyToProxy(get(braveApiKey)).then(() => warmUpSearchConnection());
        return ok;
      })
      .then((ok) => {
        webSearchWarmingUp = false;
        webSearchConnected.set(ok);
      })
      .catch(() => {
        webSearchWarmingUp = false;
        webSearchConnected.set(false);
      });
  }

  /**
   * Auto-start warm-up when web search is turned on (globe, Command Palette, etc.).
   * IMPORTANT: uses $store auto-subscriptions for Svelte 5 reactivity (get() is NOT tracked).
   * SKIP when Arena is active — DashboardArena runs its own warm-up to avoid double attempts.
   */
  $effect(() => {
    const connected = $webSearchConnected;
    if ($layout === 'arena') { webSearchWarmUpAttempted = false; return; }
    if (connected || webSearchWarmingUp || webSearchWarmUpAttempted) return;
    runWarmUp();
  });

  const chatHasLiveWeb = $derived($layout !== 'arena');
  const webButtonOn = $derived(chatHasLiveWeb || $webSearchForNextMessage);

  /** Attachments: { dataUrl, label, isVideo? } for display; we send dataUrl list to onSend. */
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
    const imageDataUrls = attachments.filter((a) => !a.isVideo).map((a) => a.dataUrl);
    const videoDataUrls = attachments.filter((a) => a.isVideo).map((a) => a.dataUrl);
    if (!userMessage && imageDataUrls.length === 0 && videoDataUrls.length === 0) return;

    const savedText = text;
    const savedAttachments = [...attachments];
    text = '';
    attachments = [];
    attachError = null;
    sendError = false;
    if (justSentTimeoutId) clearTimeout(justSentTimeoutId);
    if (sendErrorTimeoutId) clearTimeout(sendErrorTimeoutId);

    sending = true;
    try {
      if (onSend) await onSend(userMessage, imageDataUrls, videoDataUrls);
      justSent = true;
      justSentTimeoutId = setTimeout(() => {
        justSent = false;
        justSentTimeoutId = null;
      }, 1600);
    } catch (err) {
      text = savedText;
      attachments = savedAttachments;
      sendError = true;
      sendErrorTimeoutId = setTimeout(() => {
        sendError = false;
        sendErrorTimeoutId = null;
      }, 2200);
    } finally {
      sending = false;
    }
  }

  function handleImageClick() {
    const prompt = text.trim();
    const fn = typeof onGenerateImageGrok === 'function' ? onGenerateImageGrok : (typeof onGenerateImageDeepSeek === 'function' ? onGenerateImageDeepSeek : null);
    if (fn) {
      const result = fn(prompt);
      if (result && typeof result.then === 'function') {
        result.then(() => { text = ''; }).catch(() => {});
      }
    }
  }

  function handleVideoClick() {
    const fn = typeof onGenerateVideoDeepSeek === 'function' ? onGenerateVideoDeepSeek : null;
    if (fn) fn(text.trim() || '');
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
    let totalMb = attachments.reduce((sum, a) => sum + estimateDataUrlMb(a.dataUrl), 0);

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
          totalMb += estimateDataUrlMb(urls[0]) * urls.length;
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
            const videoDataUrl = await new Promise((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result);
              r.onerror = () => reject(new Error('Failed to read video'));
              r.readAsDataURL(file);
            });
            attachments = [...attachments, { dataUrl: videoDataUrl, label: file.name, isVideo: true }];
            totalMb += fileMb;
            const urls = await videoToFrames(file, { count: 8, maxDurationSec: 60 });
            if (urls.length > 0) {
              urls.forEach((url, i) => addImageDataUrls([url], `${file.name} frame ${i + 1}`));
              totalMb += urls.reduce((sum, u) => sum + estimateDataUrlMb(u), 0);
            }
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

  $effect(() => {
    const unsub = insertChatPrompt.subscribe((req) => {
      if (!req?.text) return;
      text = req.text;
      insertChatPrompt.set(null);
      tick().then(() => {
        textareaEl?.focus();
        autoResize();
      });
    });
    return () => { unsub(); };
  });

  function handleKeydown(e) {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    e.preventDefault();
    handleSubmit();
  }

  function autoResize() {
    autoResizeTextarea(textareaEl, text);
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
    const url = voiceServerBase();
    if (!url) {
      voiceError = 'Set Voice server URL in Settings (e.g. http://localhost:8765)';
      return;
    }
    voiceError = null;
    try {
      // Check server is up before grabbing the mic (retry once after 2s if server is still starting)
      let healthRes;
      try {
        healthRes = await checkVoiceServerHealth(url);
      } catch (_) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          healthRes = await checkVoiceServerHealth(url);
        } catch (__) {
          voiceError = VOICE_OFFLINE;
          return;
        }
      }
      if (!healthRes.ok) {
        voiceError = `Voice server error (${healthRes.status}). Restart ATOM from the desktop icon.`;
        return;
      }
      const stream = await acquireMicStream(get(micDeviceId));
      voiceStream = stream;
      recordingChunks = [];
      const rec = createMediaRecorder(stream);
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
        const blob = new Blob(recordingChunks, { type: rec.mimeType || 'audio/webm' });
        try {
          const transcribed = await transcribeBlob(blob, url);
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
      voiceError = micErrorMessage(e);
    }
  }

  function toggleVoice() {
    if (openMic) return;
    // Always allow clicking to stop recording (don't block on voiceProcessing)
    if (recording) {
      stopRecording();
      return;
    }
    if (voiceProcessing) return; // still uploading/transcribing
    startVoiceInput();
  }

  function voiceServerBase() {
    return resolveVoiceServerUrl(get(voiceServerUrl));
  }

  async function ensureVoiceServer() {
    const url = voiceServerBase();
    if (!url) {
      voiceError = 'Set Voice server URL in Settings (e.g. http://localhost:8765)';
      return '';
    }
    let healthRes;
    try {
      healthRes = await checkVoiceServerHealth(url);
    } catch (_) {
      await sleep(2000);
      try {
        healthRes = await checkVoiceServerHealth(url);
      } catch {
        voiceError = VOICE_OFFLINE;
        return '';
      }
    }
    if (!healthRes.ok) {
      voiceError = `Voice server error (${healthRes.status}). Restart ATOM from the desktop icon.`;
      return '';
    }
    return url;
  }

  function releaseOpenMicStream() {
    if (voiceStream) {
      voiceStream.getTracks().forEach((t) => t.stop());
      voiceStream = null;
    }
  }

  async function acquireOpenMicStream() {
    const stream = await acquireMicStream(get(micDeviceId));
    voiceStream = stream;
    return stream;
  }

  function stopOpenMic() {
    openMicGen += 1;
    openMic = false;
    openMicPhase = 'idle';
    openMicActive.set(false);
    stopTts();
    if (recording) stopRecording();
    releaseOpenMicStream();
  }

  async function startOpenMic() {
    if (openMic || recording || voiceProcessing) return;
    voiceError = null;
    const url = await ensureVoiceServer();
    if (!url) return;
    try {
      await acquireOpenMicStream();
    } catch (e) {
      voiceError = micErrorMessage(e);
      return;
    }
    const gen = ++openMicGen;
    openMic = true;
    openMicActive.set(true);
    openMicPhase = 'listening';
    unlockAudioPlayback();
    ttsReadAloudEnabled.set(true);
    ttsError.set(null);
    warmUpKokoroTts();

    while (openMic && gen === openMicGen) {
      openMicPhase = 'listening';
      if (!voiceStream) {
        try {
          await acquireOpenMicStream();
        } catch (e) {
          if (gen !== openMicGen) break;
          voiceError = micErrorMessage(e);
          break;
        }
      }
      const stream = voiceStream;
      let blob = null;
      try {
        blob = await recordUntilSilence(stream, { cancelled: () => gen !== openMicGen || !openMic });
      } catch (e) {
        if (gen !== openMicGen) break;
        voiceError = e?.message || 'Open mic recording failed';
        await sleep(600);
        continue;
      }
      if (gen !== openMicGen || !openMic) break;
      if (!blob || blob.size < 800) continue;
      openMicPhase = 'transcribing';
      voiceProcessing = true;
      try {
        const transcribed = await transcribeBlob(blob, url);
        if (gen !== openMicGen || !openMic) break;
        if (!isUsefulTranscript(transcribed)) continue;
        text = transcribed;
        releaseOpenMicStream();
        openMicPhase = 'waiting';
        await handleSubmit();
        if (gen !== openMicGen || !openMic) break;
        openMicPhase = 'speaking';
        await waitUntilReplySpoken({
          cancelled: () => gen !== openMicGen || !openMic,
          isStreaming: () => get(isStreaming),
          isTtsBusy,
        });
      } catch (e) {
        if (gen !== openMicGen) break;
        voiceError = e?.message || 'Voice server error. Is it running on ' + url + '?';
        await sleep(800);
      } finally {
        voiceProcessing = false;
      }
    }

    if (gen === openMicGen) {
      openMic = false;
      openMicPhase = 'idle';
      openMicActive.set(false);
      releaseOpenMicStream();
    }
  }

  function toggleOpenMic() {
    if (openMic) {
      stopOpenMic();
      return;
    }
    if (recording) stopRecording();
    startOpenMic();
  }

  onMount(() => {
    return () => {
      openMicGen += 1;
      openMic = false;
      openMicActive.set(false);
      stopTts();
      if (voiceStream) {
        voiceStream.getTracks().forEach((t) => t.stop());
        voiceStream = null;
      }
    };
  });
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
  {#if attachments.length > 0}
    <div class="attachments-row">
      {#each attachments as att, i}
        <div class="attachment-thumb">
          {#if att.isVideo}
            <div class="thumb-video-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" opacity="0.7"><polygon points="10 8 16 12 10 16"/></svg>
            </div>
          {:else if att.dataUrl.startsWith('data:image')}
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
  <div class="chat-input-bar" class:sending class:just-sent={justSent} class:send-error={sendError}>
    <div class="chat-input-bar-attach">
      <div class="attach-button-wrap">
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
            <span class="attach-icon" aria-hidden="true">📎</span>
          {/if}
        </button>
      </div>
    </div>
    <div class="chat-input-main">
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
    {#if onGenerateImageGrok || onGenerateImageDeepSeek || onGenerateVideoDeepSeek}
    <div class="media-toolbar media-toolbar-inline">
      {#if onGenerateImageGrok || onGenerateImageDeepSeek}
        <button
          type="button"
          class="media-btn {imageGenerating ? 'media-btn-active media-btn-image-active' : ''}"
          disabled={$isStreaming || imageGenerating}
          onclick={handleImageClick}
          title={imageGenerating ? 'Generating image…' : (onGenerateImageGrok ? 'Generate image (Grok)' : 'Generate image (DeepInfra)')}
          aria-label={imageGenerating ? 'Generating image' : 'Generate image'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" class="{imageGenerating ? 'media-anim-flash-color' : 'media-icon-pulse-dot'}"/>
            <path d="M3 16l5-5 3 3 4-4 6 6v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2z" fill="currentColor" opacity="0.15" stroke="none"/>
            <path d="M3 16l5-5 3 3 4-4 6 6"/>
          </svg>
          <span class="media-btn-label">{imageGenerating ? '…' : 'Image'}</span>
        </button>
      {/if}
      {#if onGenerateVideoDeepSeek}
        <button
          type="button"
          class="media-btn {videoGenerating ? 'media-btn-active media-btn-video-active' : ''}"
          disabled={$isStreaming || videoGenerating}
          onclick={handleVideoClick}
          title={videoGenerating ? `Generating video… ${videoGenElapsed}` : 'Generate video (DeepInfra)'}
          aria-label={videoGenerating ? 'Generating video' : 'Generate video'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="3"/>
            <circle cx="5" cy="6" r="1.2" fill="currentColor" stroke="none" opacity="0.5"/>
            <circle cx="12" cy="6" r="1.2" fill="currentColor" stroke="none" opacity="0.5"/>
            <circle cx="19" cy="6" r="1.2" fill="currentColor" stroke="none" opacity="0.5"/>
            <polygon points="9,9 9,17 15,13" fill="currentColor" opacity="0.3" stroke="none"/>
            <polygon points="9,9 9,17 15,13"/>
          </svg>
          {#if videoGenerating}
            <span class="media-elapsed-dot media-elapsed-dot-lg" aria-hidden="true"></span><span class="media-elapsed">{videoGenElapsed}</span>
          {/if}
          <span class="media-btn-label">{videoGenerating ? '' : 'Video'}</span>
        </button>
      {/if}
    </div>
  {/if}
  <div class="composer-tools" role="toolbar" aria-label="Thinking, context, talk, dictate, speak, and web">
  {#if $layout !== 'arena'}
    <ThinkingControls
      compact
      modelId={$effectiveModelId}
      thinking={$settings.thinking}
      speed={$settings.thinking_speed}
      onChange={onThinkingChange}
    />
  {/if}
  <div class="tool-btn context-tool" title="Context used">
    <span class="tool-icon-wrap">
      <ContextRing inline />
    </span>
    <span class="tool-label">Ctx</span>
  </div>
  <button
    type="button"
    class="tool-btn"
    class:tool-btn-on={openMic}
    title={openMic ? 'Live talk on — click to hang up' : 'Live talk — hands-free: you speak, it answers out loud, then it listens again'}
    disabled={!openMic && ($isStreaming || (voiceProcessing && !recording))}
    onclick={toggleOpenMic}
    aria-label={openMic ? 'Stop live talk' : 'Start live talk'}
    aria-pressed={openMic}
  >
    <span class="tool-icon-wrap">
      {#if openMic && openMicPhase === 'transcribing'}
        <span class="mic-spinner" aria-hidden="true">⟳</span>
      {:else}
        <svg class="tool-glyph" class:tool-glyph-live={openMic} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 15v-1a8 8 0 0 1 16 0v1" />
          <rect x="2.5" y="13" width="4.5" height="7" rx="1.6" />
          <rect x="17" y="13" width="4.5" height="7" rx="1.6" />
        </svg>
      {/if}
      {#if openMic}<span class="tool-pip tool-pip-live" aria-hidden="true"></span>{/if}
    </span>
    <span class="tool-label">{openMic ? 'Live' : 'Talk'}</span>
  </button>
  <button
    type="button"
    class="tool-btn"
    class:tool-btn-rec={recording}
    title={recording ? 'Dictating — click to stop' : 'Dictate — click, talk, click again. Then send.'}
    disabled={openMic || $isStreaming || (voiceProcessing && !recording)}
    onclick={toggleVoice}
    aria-label={recording ? 'Stop dictation' : 'Start dictation'}
    aria-pressed={recording}
  >
    <span class="tool-icon-wrap">
      {#if voiceProcessing && !recording}
        <span class="mic-spinner" aria-hidden="true">⟳</span>
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="2.5" width="6" height="11" rx="3" />
          <path d="M6 11a6 6 0 0 0 12 0" />
          <line x1="12" y1="17" x2="12" y2="20.5" />
          <line x1="8" y1="20.5" x2="16" y2="20.5" />
        </svg>
      {/if}
      {#if recording}<span class="tool-pip tool-pip-rec" aria-hidden="true"></span>{/if}
    </span>
    <span class="tool-label">{recording ? 'Rec' : 'Dictate'}</span>
  </button>
  <button
    type="button"
    class="tool-btn"
    class:tool-btn-on={$ttsReadAloudEnabled}
    class:tool-btn-busy={ttsSpeaking}
    title={$voiceRoleplaySessionActive
      ? 'Speak is paused while Eve is active'
      : $ttsReadAloudEnabled
        ? (ttsSpeaking ? 'Speaking the reply… click to mute' : 'Speak on — replies are read aloud (click to mute, Shift+click for voice settings)')
        : 'Speak off — click to read replies aloud (Shift+click for voice settings)'}
    disabled={$voiceRoleplaySessionActive}
    onclick={onReadAloudClick}
    aria-label={$ttsReadAloudEnabled ? 'Speak on' : 'Speak off'}
    aria-pressed={$ttsReadAloudEnabled}
  >
    <span class="tool-icon-wrap">
      <svg class:tool-glyph-speak={ttsSpeaking} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        {#if $ttsReadAloudEnabled}
          <path class="speak-wave speak-wave-1" d="M15.5 8.5a5 5 0 0 1 0 7"></path>
          <path class="speak-wave speak-wave-2" d="M18.7 5.8a9 9 0 0 1 0 12.4"></path>
        {:else}
          <line x1="16" y1="9" x2="22" y2="15"></line>
          <line x1="22" y1="9" x2="16" y2="15"></line>
        {/if}
      </svg>
      {#if $ttsReadAloudEnabled}<span class="tool-pip" class:tool-pip-busy={ttsSpeaking} aria-hidden="true"></span>{/if}
    </span>
    <span class="tool-label">Speak</span>
  </button>
  <div class="volume-wrap" bind:this={volumeWrapEl}>
    <button
      type="button"
      class="tool-btn"
      class:tool-btn-on={volumeOpen}
      title="ATOM volume — only this app, not system volume"
      onclick={onVolumeClick}
      aria-label={`ATOM volume ${volumePct} percent`}
      aria-expanded={volumeOpen}
    >
      <span class="tool-icon-wrap">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          {#if volumePct === 0}
            <line x1="16" y1="9" x2="22" y2="15"></line>
            <line x1="22" y1="9" x2="16" y2="15"></line>
          {:else if volumePct < 50}
            <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"></path>
          {:else}
            <path d="M15.5 8.5a5 5 0 0 1 0 7"></path>
            <path d="M18.7 5.8a9 9 0 0 1 0 12.4"></path>
          {/if}
        </svg>
      </span>
      <span class="tool-label">{volumePct}%</span>
    </button>
    {#if volumeOpen}
      <div class="volume-popover" role="dialog" aria-label="ATOM volume">
        <p class="volume-popover-title">ATOM volume</p>
        <div class="volume-popover-row">
          <input
            id="atom-chat-volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            bind:value={$ttsVolume}
            class="volume-slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={volumePct}
            aria-label="ATOM playback volume"
          />
          <span class="volume-popover-pct">{volumePct}%</span>
        </div>
        <p class="volume-popover-hint">Only ATOM. Does not change system volume.</p>
      </div>
    {/if}
  </div>
  <button
    type="button"
    class="tool-btn"
    class:tool-btn-on={webButtonOn}
    title={webSearchWarmingUp ? 'Connecting to the web…' : chatHasLiveWeb ? ($webSearchConnected ? 'Web on — the model can search and fetch pages (click to reconnect)' : 'Web on — Brave not connected yet (click to retry)') : $webSearchForNextMessage ? ($webSearchConnected ? 'Web on — Arena will attach search results (click to turn off)' : 'Web on — not connected yet (click again to retry)') : 'Web off — click to attach web results in Arena'}
    disabled={$isStreaming}
    onclick={() => {
      if (chatHasLiveWeb) {
        webSearchWarmUpAttempted = false;
        runWarmUp();
        return;
      }
      const on = $webSearchForNextMessage;
      const connected = $webSearchConnected;
      if (on && !connected && !webSearchWarmingUp) {
        webSearchWarmUpAttempted = false;
        runWarmUp();
        return;
      }
      if (on) {
        webSearchForNextMessage.set(false);
        webSearchConnected.set(false);
        return;
      }
      webSearchForNextMessage.set(true);
      runWarmUp();
    }}
    aria-label={webSearchWarmingUp ? 'Connecting to the web' : webButtonOn ? 'Web search on' : 'Web search off'}
    aria-pressed={webButtonOn}
    aria-busy={webSearchWarmingUp}
  >
    <span class="tool-icon-wrap">
      <svg class:web-search-icon-spin={webSearchWarmingUp} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18" />
        <path d="M12 3a14 14 0 0 0 0 18" />
      </svg>
      {#if webButtonOn}
        <span class="tool-pip" class:tool-pip-live={$webSearchConnected} class:tool-pip-rec={!$webSearchConnected} class:tool-pip-busy={webSearchWarmingUp} aria-hidden="true"></span>
      {/if}
    </span>
    <span class="tool-label">Web</span>
  </button>
  </div>
  {#if $isStreaming && onStop}
    <button type="button" class="send-button" style="background: var(--ui-accent-hot, #dc2626);" onclick={() => onStop()} title="Stop">Stop</button>
  {:else}
    <button
      onclick={handleSubmit}
      disabled={$isStreaming || $webSearchInProgress || justSent || (!text.trim() && attachments.length === 0)}
      class="send-button"
      class:send-ready={canSend && !justSent}
    >
      {#if justSent}
        <span class="send-feedback send-feedback-success" aria-live="polite">✓ Sent</span>
      {:else if sendError}
        <span class="send-feedback send-feedback-error" aria-live="assertive">✕ Try again</span>
      {:else if $webSearchInProgress}
        <span class="inline-flex items-center gap-1.5"><ThinkingAtom size={16} />{searchingMessage || 'Searching…'}</span>
      {:else if $isStreaming}
        <span class="inline-flex items-center gap-1.5"><ThinkingAtom size={16} />{sendingMessage || 'Sending…'}</span>
      {:else}
        Send
      {/if}
    </button>
  {/if}
  </div>
  {#if openMic}
    <span class="voice-recording-hint" aria-live="polite">
      <span class="recording-dot" aria-hidden="true"></span>
      {#if openMicPhase === 'listening'}
        Live talk — listening… speak, then pause
      {:else if openMicPhase === 'transcribing'}
        Live talk — transcribing…
      {:else if openMicPhase === 'waiting'}
        Live talk — mic off, waiting for reply…
      {:else}
        Live talk — mic off, speaking reply…
      {/if}
    </span>
  {:else if recording}
    <span class="voice-recording-hint" aria-live="polite">
      <span class="recording-dot" aria-hidden="true"></span>
      Dictating — click Dictate to stop
    </span>
  {/if}
  {#if voiceError}
    <div class="voice-error" role="alert">
      <span>{voiceError}</span>
      {#if /microphone|mic/i.test(voiceError)}
        <button
          type="button"
          class="voice-error-settings"
          onclick={() => { settingsFocus.set('microphone'); settingsOpen.set(true); }}
        >
          Settings
        </button>
      {/if}
      <button type="button" class="voice-error-dismiss" onclick={() => (voiceError = null)} aria-label="Dismiss">×</button>
    </div>
  {/if}
  {#if $ttsError}
    <div class="voice-error" role="alert">
      <span>{$ttsError}</span>
      <button type="button" class="voice-error-dismiss" onclick={() => ttsError.set(null)} aria-label="Dismiss">×</button>
    </div>
  {/if}
  {#if attachError}
    <p class="attach-error" role="alert">{attachError}</p>
  {/if}
  <p class="chat-input-hint" aria-hidden="true">{sendHint}</p>
</div>

<style>
  .chat-input-container {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 12px 12px 8px;
  }

  @media (min-width: 640px) {
    .chat-input-container {
      padding: 16px 16px 10px;
    }
  }

  .chat-input-hint {
    margin: 6px 4px 0;
    font-size: 10px;
    text-align: right;
    color: var(--ui-text-secondary);
    opacity: 0.65;
    user-select: none;
  }

  .chat-input-bar {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    min-height: 52px;
    border-radius: 12px;
    background: var(--ui-input-bg, #fff);
    border: 1px solid color-mix(in srgb, var(--ui-border, #e5e7eb) 50%, transparent);
    transition: border-color 150ms, box-shadow 150ms;
    overflow: visible;
  }

  .chat-input-bar:focus-within {
    border-color: color-mix(in srgb, var(--ui-accent, #3b82f6) 45%, var(--ui-border));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent, #3b82f6) 12%, transparent);
  }

  .chat-input-bar-attach {
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-left: 8px;
  }
  .chat-input-bar .media-toolbar-inline {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .chat-input-bar .media-toolbar-inline .media-btn {
    flex-direction: column;
    height: auto;
    min-height: 48px;
    min-width: 36px;
    width: 36px;
    padding: 4px 2px 3px;
    gap: 2px;
    border-radius: 8px;
  }
  .chat-input-bar .media-toolbar-inline .media-btn .media-btn-label {
    display: block;
    font-size: 8px;
    letter-spacing: 0.04em;
  }
  .chat-input-bar-attach .attach-button-wrap {
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .chat-input-bar-attach .attach-button {
    width: 40px;
    height: 40px;
    min-height: 40px;
    background: transparent;
    border-radius: 6px;
    color: var(--ui-text-secondary, #6b7280);
  }
  .chat-input-bar-attach .attach-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-accent) 10%, transparent);
    color: var(--ui-accent);
  }
  .chat-input-bar-attach .attach-button:active:not(:disabled) {
    transform: scale(0.94);
    transition: transform 0.1s ease;
  }

  .chat-input-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    background: transparent;
    border: none;
    border-radius: 0;
    align-self: stretch;
  }

  .chat-input-bar .composer-tools {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    gap: 0;
    padding: 0 2px;
  }
  .chat-input-bar .tool-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 46px;
    min-width: 46px;
    height: auto;
    min-height: 48px;
    padding: 4px 2px 3px;
    border: none;
    background: transparent;
    border-radius: 8px;
    color: var(--ui-text-secondary, #6b7280);
    cursor: pointer;
  }
  .chat-input-bar .tool-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-accent) 10%, transparent);
    color: var(--ui-accent);
  }
  .chat-input-bar .tool-btn.tool-btn-on {
    background: color-mix(in srgb, var(--ui-accent) 12%, transparent);
    color: var(--ui-accent);
  }
  .chat-input-bar .tool-btn.tool-btn-rec {
    color: var(--ui-accent-hot, #dc2626);
    background: color-mix(in srgb, var(--ui-accent-hot, #dc2626) 12%, transparent);
  }
  .chat-input-bar .tool-btn:active:not(:disabled) {
    transform: scale(0.94);
    transition: transform 0.1s ease;
  }
  .chat-input-bar .tool-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .chat-input-bar .context-tool {
    cursor: default;
  }
  .chat-input-bar .context-tool .tool-icon-wrap {
    width: 24px;
    height: 24px;
  }
  .tool-icon-wrap {
    position: relative;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tool-label {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .tool-pip {
    position: absolute;
    top: -2px;
    right: -3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ui-accent);
    box-shadow: 0 0 0 1.5px var(--ui-input-bg, #fff);
    pointer-events: none;
  }
  .tool-pip-live {
    background: #22c55e;
  }
  .tool-pip-rec {
    background: var(--ui-accent-hot, #dc2626);
    animation: pulse 1s ease-in-out infinite;
  }
  .tool-pip-busy {
    animation: pulse 0.8s ease-in-out infinite;
  }
  .volume-wrap {
    position: relative;
    display: flex;
    align-items: stretch;
  }
  .volume-popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    z-index: 80;
    width: 220px;
    padding: 10px 12px 8px;
    border-radius: 10px;
    border: 1px solid var(--ui-border);
    background: var(--ui-bg-main);
    box-shadow: 0 8px 24px color-mix(in srgb, #000 18%, transparent);
  }
  .volume-popover-title {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--ui-text-primary);
  }
  .volume-popover-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .volume-slider {
    flex: 1;
    min-width: 0;
    height: 6px;
    accent-color: var(--ui-accent);
  }
  .volume-popover-pct {
    flex-shrink: 0;
    width: 2.4em;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    color: var(--ui-text-primary);
    text-align: right;
  }
  .volume-popover-hint {
    margin: 6px 0 0;
    font-size: 10px;
    line-height: 1.3;
    color: var(--ui-text-secondary);
  }
  .tool-glyph-live {
    animation: open-mic-pulse 1.4s ease-in-out infinite;
  }
  .tool-glyph-speak .speak-wave {
    transform-origin: 12px 12px;
  }
  .tool-glyph-speak .speak-wave-1 {
    animation: speak-wave 1.1s ease-in-out infinite;
  }
  .tool-glyph-speak .speak-wave-2 {
    animation: speak-wave 1.1s ease-in-out infinite 0.15s;
  }
  @keyframes speak-wave {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
  }
  .chat-input-bar .send-button {
    flex-shrink: 0;
    align-self: stretch;
    margin: 0;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 0 12px 12px 0;
    font-weight: 600;
    background: var(--ui-action, var(--ui-accent));
    color: var(--ui-action-ink, var(--ui-bg-main));
  }
  .chat-input-bar .send-button:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .chat-input-bar .send-button:active:not(:disabled) {
    transform: scale(0.98);
    transition: transform 0.1s ease;
  }
  .chat-input-bar .send-button.send-ready:not(:disabled) {
    animation: send-ready-pulse 2s ease-in-out infinite;
  }
  @keyframes send-ready-pulse {
    0%, 100% { filter: brightness(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-action, var(--ui-accent)) 25%, transparent); }
    50% { filter: brightness(1.06); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-action, var(--ui-accent)) 18%, transparent); }
  }
  .send-feedback {
    font-size: 13px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .send-feedback-success {
    color: #16a34a;
  }
  .send-feedback-error {
    color: var(--ui-accent-hot, #dc2626);
  }
  .chat-input-bar.sending {
    opacity: 0.92;
    transition: opacity 0.2s ease;
  }
  .chat-input-bar.send-error {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent-hot, #dc2626) 25%, transparent);
    transition: box-shadow 0.2s ease;
  }
  .chat-input-main textarea {
    flex: 1;
    width: 100%;
    min-width: 0;
    padding: 10px 12px;
    border: none;
    font-family: inherit;
    font-size: 14px;
    resize: none;
    min-height: 44px;
    max-height: 200px;
    overflow-y: auto;
    background: transparent;
    color: var(--ui-text-primary, #111);
  }

  textarea:focus {
    outline: none;
  }

  textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .send-button {
    padding: 12px 24px;
    min-height: 44px;
    background: var(--ui-action, var(--ui-accent, #3b82f6));
    color: var(--ui-action-ink, var(--ui-bg-main, white));
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

  /* ── Media buttons (Image / Video) ── */
  .media-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    min-height: 40px;
    min-width: 52px;
    border-radius: 10px;
    border: none;
    background: color-mix(in srgb, var(--ui-accent) 10%, transparent);
    color: var(--ui-accent);
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0 10px;
  }
  .media-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-accent) 22%, transparent);
    color: var(--ui-accent);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--ui-accent) 15%, transparent);
  }
  .media-btn:active:not(:disabled) {
    transform: translateY(0) scale(0.97);
  }
  .media-btn:disabled {
    opacity: 0.25;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }
  .media-btn-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  /* ── Active / generating state ── */
  .media-btn-active:disabled {
    opacity: 1;
    cursor: default;
  }
  .media-btn-image-active:disabled {
    color: var(--ui-accent, #3b82f6);
    background: color-mix(in srgb, var(--ui-accent, #3b82f6) 18%, transparent);
    animation: media-btn-img 1.3s ease-in-out infinite;
  }
  @keyframes media-btn-img {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-accent) 25%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--ui-accent) 7%, transparent); }
  }
  .media-btn-video-active:disabled {
    color: var(--ui-accent-hot, #dc2626);
    background: color-mix(in srgb, var(--ui-accent-hot, #dc2626) 16%, transparent);
    animation: media-btn-vid 1.0s ease-in-out infinite;
  }
  @keyframes media-btn-vid {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-accent-hot, #dc2626) 30%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--ui-accent-hot, #dc2626) 8%, transparent); }
  }

  /* ── Generating SVG animations ── */
  .media-anim-flash-color {
    animation: media-flash-color 0.9s ease-in-out infinite;
  }
  @keyframes media-flash-color {
    0%, 100% { opacity: 0.5; transform: scale(1); filter: drop-shadow(0 0 2px #f59e0b); }
    50% { opacity: 1; transform: scale(1.25); transform-origin: 12px 11px; filter: drop-shadow(0 0 6px #f59e0b); }
  }
  /* ── Idle subtle animations ── */
  .media-icon-pulse-dot {
    animation: icon-dot-pulse 3s ease-in-out infinite;
  }
  @keyframes icon-dot-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
  }

  .media-elapsed-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ui-accent-hot, #dc2626);
    animation: media-elapsed-dot-pulse 1s ease-in-out infinite;
    flex-shrink: 0;
  }
  .media-elapsed-dot-lg {
    width: 9px;
    height: 9px;
  }
  @keyframes media-elapsed-dot-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.7); }
  }

  @keyframes open-mic-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.08); }
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
    position: absolute;
    bottom: 100%;
    left: 16px;
    margin-bottom: 6px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-accent, #3b82f6);
    pointer-events: none;
  }
  .recording-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ui-accent-hot, #ef4444);
    animation: recording-pulse 1.2s ease-in-out infinite;
  }
  @keyframes recording-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.2); }
  }
  .voice-error,
  .attach-error {
    position: absolute;
    bottom: 100%;
    left: 16px;
    right: 80px;
    margin: 0 0 4px 0;
    padding: 6px 8px 6px 12px;
    font-size: 12px;
    line-height: 1.3;
    border-radius: 8px;
    background: color-mix(in srgb, var(--ui-accent-hot, #dc2626) 12%, var(--ui-bg-main));
    color: var(--ui-text-primary);
  }
  .voice-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .voice-error-dismiss {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-secondary);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .voice-error-dismiss:hover {
    color: var(--ui-text-primary);
  }
  .voice-error-settings {
    flex-shrink: 0;
    border: 0;
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    background: color-mix(in srgb, var(--ui-accent) 14%, transparent);
    color: var(--ui-accent);
    cursor: pointer;
  }
  .voice-error-settings:hover {
    filter: brightness(1.08);
  }
  .hidden-file-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }
  .attach-button-wrap {
    position: relative;
    flex-shrink: 0;
    height: 44px;
    min-height: 44px;
    align-self: flex-start;
    display: flex;
    align-items: center;
  }
  .attach-button {
    flex-shrink: 0;
    width: 44px;
    min-height: 44px;
    border-radius: 10px;
    border: none;
    background: color-mix(in srgb, var(--ui-border, #e5e7eb) 25%, var(--ui-input-bg, #fff));
    color: var(--ui-text-primary, #111);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    transition: all 150ms;
  }
  .attach-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-accent, #3b82f6) 14%, var(--ui-input-bg, #fff));
    color: var(--ui-accent, #3b82f6);
  }
  .attach-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .web-search-icon-spin {
    animation: web-search-globe-spin 1.2s linear infinite;
  }
  @keyframes web-search-globe-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .attachments-row {
    display: flex;
    flex-wrap: nowrap;
    gap: 8px;
    align-items: flex-start;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding-bottom: 2px;
  }
  .attachments-row::-webkit-scrollbar {
    display: none;
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
  .thumb-video-icon {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ui-accent, #3b82f6);
    background: color-mix(in srgb, var(--ui-accent, #3b82f6) 10%, var(--ui-input-bg, #fff));
    border-radius: 4px;
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
