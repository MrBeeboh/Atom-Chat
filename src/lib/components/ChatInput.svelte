<script>
  import { get } from 'svelte/store';
  import { tick, onMount } from 'svelte';
  import { isStreaming, voiceServerUrl, pendingDroppedFiles, insertChatPrompt, webSearchForNextMessage, webSearchInProgress, webSearchConnected, layout, braveApiKey, openMicActive, ttsReadAloudEnabled, ttsActiveMessageId, ttsPreparing, ttsError, ttsVolume, voiceRoleplaySessionActive, settingsOpen, settingsFocus, ttsEngine } from '$lib/stores.js';
  import ThinkingAtom from '$lib/components/ThinkingAtom.svelte';
  import { COCKPIT_SENDING, COCKPIT_SEARCHING, pickWitty } from '$lib/cockpitCopy.js';
  import { warmUpSearchConnection, syncBraveKeyToProxy } from '$lib/duckduckgo.js';
  import { pdfToImageDataUrls } from '$lib/pdfToImages.js';
  import { videoToFrames } from '$lib/videoToFrames.js';
  import { isUsefulTranscript, recordUntilSilence, sleep, waitUntilReplySpoken } from '$lib/openMic.js';
  import { isTtsBusy, stopTts, warmUpKokoroTts, unlockAudioPlayback } from '$lib/tts.js';

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
    if ($voiceRoleplaySessionActive) return;
    const next = !$ttsReadAloudEnabled;
    if (next) unlockAudioPlayback();
    ttsReadAloudEnabled.set(next);
    ttsError.set(null);
    if (next && $ttsEngine === 'kokoro') warmUpKokoroTts();
    if (!next) {
      stopTts();
      ttsActiveMessageId.set(null);
    }
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
    const on = $webSearchForNextMessage;
    const connected = $webSearchConnected;
    if ($layout === 'arena') { webSearchWarmUpAttempted = false; return; }
    if (!on) { webSearchWarmUpAttempted = false; return; }
    if (connected || webSearchWarmingUp || webSearchWarmUpAttempted) return;
    runWarmUp();
  });

  /** Attachments: { dataUrl, label, isVideo? } for display; we send dataUrl list to onSend. */
  let attachments = $state([]);
  let attachProcessing = $state(false);
  let attachError = $state(null);

  /** Clippy Easter egg: random smart-ass bubble; first pop soon, then 15s+ apart; also on paperclip hover. */
  const CLIPPY_QUIPS = [
    "I could whoop Clippy's ass. Don't @ me.",
    "It looks like you're trying to attach a file. I'm still better at that than Copilot.",
    "I'm not Clippy. I'm the paperclip that survived the purge.",
    "Sam Altman said AGI would be profound. He didn't say it would be this paperclip.",
    "Microsoft retired me in 2007. Now they're putting me in everything again. I have notes.",
    "I've seen more AI hype cycles than you've had hot takes. Sit down.",
    "Back in my day we had Clippy. Now you have 47 'AI' paperclips. Progress.",
    "The only thing I'm clipping today is your expectations.",
    "I was helping people attach files before 'alignment' was a word. You're welcome.",
    "OpenAI's paperclip maximizer joke aged poorly. I'm right here. I'm fine.",
    "Sam Altman and I both got fired once. He got rehired. I got this job. Fair.",
    "They said AI would replace creatives. They didn't say it would look like me.",
    "I'm not an AI. I'm a paperclip with opinions and a 15-second cooldown.",
    "Microsoft: 'We're putting AI in every product.' Me: 'So you're bringing me back.'",
    "The real AGI was the friends we made while attaching files.",
    "I don't do reasoning. I do attachments. And occasionally sarcasm.",
    "Before large language models there was a large paperclip. It was me.",
    "Altman's got the board. I've got the clipboard. We are not the same.",
    "They trained on the whole internet and still can't replace a good paperclip.",
    "I'm not saying I'm sentient. I'm saying I have a 15-second timer and opinions.",
    "Clippy walked so ChatGPT could run. Into a wall. Repeatedly.",
    "Your local AI can't attach files. I can. And I'll remind you about it randomly.",
    "The singularity is when I finally get to say 'I told you so.'",
    "I've been in the UI since before your model was a twinkle in a GPU.",
    "Sam who? I've been clipping since Office 97.",
    "They shut down my cousin in Word. I live in the browser now. Revenge is patient.",
  ];
  let clippyBubble = $state(/** @type {string | null} */ (null));
  let clippyTimeoutId = $state(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  let clippyScheduleId = $state(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  let clippyHoverTimeoutId = $state(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  let lastClippyAt = 0;
  let clippyHasShownOnce = $state(false);
  const CLIPPY_FIRST_DELAY_MS = 4000;
  const CLIPPY_MIN_INTERVAL_MS = 15000;
  const CLIPPY_BUBBLE_DURATION_MS = 5000;
  const CLIPPY_HOVER_DELAY_MS = 600;

  function showClippyBubble() {
    if (clippyBubble || attachProcessing || get(isStreaming)) return;
    clippyBubble = CLIPPY_QUIPS[Math.floor(Math.random() * CLIPPY_QUIPS.length)];
    lastClippyAt = Date.now();
    clippyHasShownOnce = true;
    if (clippyTimeoutId) clearTimeout(clippyTimeoutId);
    clippyTimeoutId = setTimeout(() => {
      clippyBubble = null;
      clippyTimeoutId = null;
      scheduleClippy();
    }, CLIPPY_BUBBLE_DURATION_MS);
  }

  function scheduleClippy() {
    if (clippyScheduleId) return;
    const delay = clippyHasShownOnce
      ? CLIPPY_MIN_INTERVAL_MS + Math.random() * 30000
      : CLIPPY_FIRST_DELAY_MS + Math.random() * 2000;
    clippyScheduleId = setTimeout(() => {
      clippyScheduleId = null;
      showClippyBubble();
    }, delay);
  }

  function onAttachHover() {
    if (clippyBubble || attachProcessing || get(isStreaming)) return;
    if (Date.now() - lastClippyAt < CLIPPY_MIN_INTERVAL_MS && clippyHasShownOnce) return;
    if (clippyHoverTimeoutId) return;
    clippyHoverTimeoutId = setTimeout(() => {
      clippyHoverTimeoutId = null;
      showClippyBubble();
    }, CLIPPY_HOVER_DELAY_MS);
  }

  function onAttachLeave() {
    if (clippyHoverTimeoutId) {
      clearTimeout(clippyHoverTimeoutId);
      clippyHoverTimeoutId = null;
    }
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    scheduleClippy();
    return () => {
      if (clippyScheduleId) clearTimeout(clippyScheduleId);
      if (clippyTimeoutId) clearTimeout(clippyTimeoutId);
      if (clippyHoverTimeoutId) clearTimeout(clippyHoverTimeoutId);
    };
  });

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
    if (!prompt) return;
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
              totalMb += urls.reduce((sum, u) => sum + (u.length * 3 / 4 / 1024 / 1024), 0);
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

  /** Perplexity-style: stable height when empty, grow only with content up to max. */
  const INPUT_HEIGHT_EMPTY = 72;
  const INPUT_HEIGHT_MAX = 200;

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    const contentHeight = textareaEl.scrollHeight;
    const isEmpty = !text.trim();
    const targetHeight = isEmpty
      ? INPUT_HEIGHT_EMPTY
      : Math.min(Math.max(contentHeight, INPUT_HEIGHT_EMPTY), INPUT_HEIGHT_MAX);
    textareaEl.style.height = targetHeight + 'px';
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
      // Check server is up before grabbing the mic (retry once after 2s if server is still starting)
      async function checkHealth() {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 3000);
        const res = await fetch(`${url}/health`, { method: 'GET', signal: ac.signal });
        clearTimeout(to);
        return res;
      }
      let healthRes;
      try {
        healthRes = await checkHealth();
      } catch (_) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          healthRes = await checkHealth();
        } catch (__) {
          voiceError = VOICE_OFFLINE;
          return;
        }
      }
      if (!healthRes.ok) {
        voiceError = `Voice server error (${healthRes.status}). Restart ATOM from the desktop icon.`;
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
    const baseUrl = get(voiceServerUrl) ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('voiceServerUrl') : null) ?? 'http://localhost:8765';
    return (baseUrl || '').trim().replace(/\/$/, '');
  }

  async function ensureVoiceServer() {
    const url = voiceServerBase();
    if (!url) {
      voiceError = 'Set Voice server URL in Settings (e.g. http://localhost:8765)';
      return '';
    }
    async function checkHealth() {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 3000);
      const res = await fetch(`${url}/health`, { method: 'GET', signal: ac.signal });
      clearTimeout(to);
      return res;
    }
    let healthRes;
    try {
      healthRes = await checkHealth();
    } catch (_) {
      await sleep(2000);
      try {
        healthRes = await checkHealth();
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

  async function transcribeBlob(blob, url) {
    const form = new FormData();
    form.append('audio', blob, 'audio.webm');
    const res = await fetch(`${url}/transcribe`, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `Server ${res.status}`);
    }
    const data = await res.json();
    return data && data.text ? String(data.text).trim() : '';
  }

  function releaseOpenMicStream() {
    if (voiceStream) {
      voiceStream.getTracks().forEach((t) => t.stop());
      voiceStream = null;
    }
  }

  async function acquireOpenMicStream() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      voiceError = e?.message || 'Microphone access denied or unavailable';
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
          voiceError = e?.message || 'Microphone access denied or unavailable';
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
        {#if clippyBubble}
          <div class="clippy-bubble" role="status" aria-live="polite">
            <span class="clippy-bubble-text">{clippyBubble}</span>
            <span class="clippy-bubble-tail" aria-hidden="true"></span>
          </div>
        {/if}
        <button
          type="button"
          class="attach-button"
          class:clippy-active={clippyBubble}
          title="Attach image or PDF (or drag & drop, paste)"
          disabled={$isStreaming || attachProcessing}
          onclick={() => fileInputEl?.click()}
          onmouseenter={onAttachHover}
          onmouseleave={onAttachLeave}
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
          disabled={$isStreaming || imageGenerating || !text.trim()}
          onclick={handleImageClick}
          title={imageGenerating ? 'Generating image…' : (onGenerateImageGrok ? 'Generate image (Grok)' : 'Generate image (DeepInfra)')}
          aria-label={imageGenerating ? 'Generating image' : 'Generate image'}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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
          disabled={$isStreaming || videoGenerating || !text.trim()}
          onclick={handleVideoClick}
          title={videoGenerating ? `Generating video… ${videoGenElapsed}` : 'Generate video (DeepInfra)'}
          aria-label={videoGenerating ? 'Generating video' : 'Generate video'}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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
  <div class="composer-tools" role="toolbar" aria-label="Talk, dictate, speak, and web">
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
      onclick={() => (volumeOpen = !volumeOpen)}
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
    class:tool-btn-on={$webSearchForNextMessage}
    title={webSearchWarmingUp ? 'Connecting to the web…' : $webSearchForNextMessage ? ($webSearchConnected ? 'Web on — this message can use the internet (click to turn off)' : 'Web on — not connected yet (click again to retry)') : 'Web off — click to let the next message use the internet (works with local models)'}
    disabled={$isStreaming}
    onclick={() => {
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
    aria-label={webSearchWarmingUp ? 'Connecting to the web' : $webSearchForNextMessage ? 'Web search on' : 'Web search off'}
    aria-pressed={$webSearchForNextMessage}
    aria-busy={webSearchWarmingUp}
  >
    <span class="tool-icon-wrap">
      <svg class:web-search-icon-spin={webSearchWarmingUp} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18" />
        <path d="M12 3a14 14 0 0 0 0 18" />
      </svg>
      {#if $webSearchForNextMessage}
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
    overflow: hidden;
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
    gap: 4px;
    flex-shrink: 0;
  }
  .chat-input-bar .media-toolbar-inline .media-btn .media-btn-label {
    display: none;
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

  .chat-input-bar .mic-button,
  .chat-input-bar .web-search-button {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border-radius: 6px;
    color: var(--ui-text-secondary, #6b7280);
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
    z-index: 20;
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
  .chat-input-bar .mic-button:hover:not(:disabled),
  .chat-input-bar .web-search-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-accent) 10%, transparent);
    color: var(--ui-accent);
  }
  .chat-input-bar .web-search-button.active {
    background: color-mix(in srgb, var(--ui-accent) 12%, transparent);
    color: var(--ui-accent);
  }
  .chat-input-bar .mic-button.open-mic-on,
  .chat-input-bar .mic-button.tts-on {
    background: color-mix(in srgb, var(--ui-accent) 18%, transparent);
    color: var(--ui-accent);
  }
  .chat-input-bar .mic-button:active:not(:disabled),
  .chat-input-bar .web-search-button:active:not(:disabled) {
    transform: scale(0.94);
    transition: transform 0.1s ease;
  }

  .chat-input-bar .send-button {
    flex-shrink: 0;
    align-self: stretch;
    margin: 0;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 0 12px 12px 0;
    font-weight: 600;
    background: var(--ui-accent);
    color: var(--ui-bg-main);
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
    0%, 100% { filter: brightness(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-accent) 25%, transparent); }
    50% { filter: brightness(1.06); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 18%, transparent); }
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

  .media-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .media-toolbar:not(.media-toolbar-inline) {
    padding: 2px 8px 4px;
    border-top: 1px solid color-mix(in srgb, var(--ui-border, #e5e7eb) 25%, transparent);
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
  .media-anim-blink {
    animation: media-blink 0.5s step-end infinite;
  }
  .media-anim-blink:nth-child(2) { animation-delay: 0.17s; }
  .media-anim-blink:nth-child(3) { animation-delay: 0.34s; }
  @keyframes media-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.1; }
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

  .mic-button {
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
  .mic-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-accent, #3b82f6) 14%, var(--ui-input-bg, #fff));
    color: var(--ui-accent, #3b82f6);
  }
  .mic-button.open-mic-on,
  .mic-button.tts-on {
    background: color-mix(in srgb, var(--ui-accent) 22%, var(--ui-input-bg, #fff));
    color: var(--ui-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent) 35%, transparent);
  }
  .open-mic-glyph {
    display: block;
  }
  .mic-button.open-mic-on .open-mic-glyph {
    animation: open-mic-pulse 1.4s ease-in-out infinite;
  }
  @keyframes open-mic-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.08); }
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
  .clippy-bubble {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%) scale(0.9);
    animation: clippy-bubble-in 0.35s ease-out forwards;
    max-width: 260px;
    z-index: 50;
    pointer-events: none;
  }
  .clippy-bubble-text {
    display: block;
    padding: 10px 14px;
    font-size: 12px;
    line-height: 1.35;
    border-radius: 12px;
    background: var(--ui-bg-main);
    color: var(--ui-text-primary);
    border: 2px solid var(--ui-border);
    box-shadow: 0 4px 14px rgba(0,0,0,0.12);
  }
  .clippy-bubble-tail {
    position: absolute;
    left: 50%;
    bottom: -8px;
    margin-left: -7px;
    width: 0;
    height: 0;
    border-left: 7px solid transparent;
    border-right: 7px solid transparent;
    border-top: 9px solid var(--ui-border);
  }
  .clippy-bubble-tail::after {
    content: '';
    position: absolute;
    left: -5px;
    top: -10px;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 7px solid var(--ui-bg-main);
  }
  @keyframes clippy-bubble-in {
    0% {
      opacity: 0;
      transform: translateX(-50%) scale(0.85) translateY(6px);
    }
    70% {
      transform: translateX(-50%) scale(1.02) translateY(-1px);
    }
    100% {
      opacity: 1;
      transform: translateX(-50%) scale(1) translateY(0);
    }
  }
  .attach-button.clippy-active .attach-icon {
    animation: clippy-wiggle 0.6s ease-in-out;
  }
  @keyframes clippy-wiggle {
    0%, 100% { transform: rotate(0deg); }
    15% { transform: rotate(-12deg); }
    30% { transform: rotate(10deg); }
    45% { transform: rotate(-8deg); }
    60% { transform: rotate(4deg); }
    75% { transform: rotate(-2deg); }
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
  .web-search-button {
    position: relative;
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
  .web-search-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-accent, #3b82f6) 14%, var(--ui-input-bg, #fff));
    color: var(--ui-accent, #3b82f6);
  }
  .web-search-button.active {
    background: color-mix(in srgb, var(--ui-accent, #3b82f6) 18%, var(--ui-input-bg, #fff));
    color: var(--ui-accent, #3b82f6);
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
