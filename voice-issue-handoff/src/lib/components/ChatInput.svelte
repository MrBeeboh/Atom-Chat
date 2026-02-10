<script>
  import { isStreaming, insertIntoInput, insertAppend, suggestionExpanded, webSearchForNextMessage, webSearchInProgress, settings, effectiveModelId } from '$lib/stores.js';
  import { playClick, playSend } from '$lib/audio.js';
  import { routeFiles, routeFile } from '$lib/fileHandler.js';

  let { onSend, onStop, onSearchWeb } = $props();
  let text = $state('');
  let images = $state([]);
  /** Ref so recognition callbacks always read/write the current input (avoids stale closure after send/restart). */
  let textRef = $state({ current: '' });
  $effect(() => {
    textRef.current = text;
  });

  $effect(() => {
    const val = $insertIntoInput;
    if (val) {
      text = val;
      insertIntoInput.set('');
    }
  });
  $effect(() => {
    const val = $insertAppend;
    if (val) {
      text = text ? text + '\n\n' + val : val;
      insertAppend.set('');
    }
  });

  function pickElaboration(option) {
    if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
    insertIntoInput.set(option);
    suggestionExpanded.set(null);
  }
  // Voice: FSM for high-reliability mic (avoid "works once, fails twice")
  const VOICE_STATES = /** @type {const} */ ({ IDLE: 'idle', STARTING: 'starting', LISTENING: 'listening', PROCESSING: 'processing', ERROR: 'error' });
  let voiceState = $state('idle');
  let recognition = $state(null);
  let interimText = $state('');
  let micError = $state('');
  let inputError = $state('');
  let lastResultAt = $state(0);
  let isFileProcessing = $state(false);
  let noResultTimer = null;
  let startTimeout = null;
  let lastVoiceStopAt = 0;
  /** @type {MediaStream | null} - hold only while we own the mic; always stop tracks in teardown */
  let micStreamRef = $state(null);
  const VOICE_COOLDOWN_MS = 1800;
  /** True from mic-on click until mic-off click; used to auto-restart on browser onend (always-on). */
  let userWantsMicOn = $state(false);
  const isListening = $derived(voiceState === VOICE_STATES.LISTENING);
  const micStarting = $derived(voiceState === VOICE_STATES.STARTING);
  const micTitle = $derived(
    voiceState === VOICE_STATES.STARTING
      ? 'Starting mic…'
      : voiceState === VOICE_STATES.LISTENING
        ? 'Mic: listening'
        : micError
          ? `Mic error: ${micError}`
          : 'Voice input (microphone)'
  );

  $effect(() => {
    return () => stopVoice();
  });
  $effect(() => {
    if (typeof document === 'undefined') return;
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden' && voiceState !== VOICE_STATES.IDLE) {
        stopVoice();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  /** Stop mic and return to IDLE. Sets userWantsMicOn false so onend won't auto-restart. */
  function stopVoice(clearError = true) {
    userWantsMicOn = false;
    interimText = '';
    if (noResultTimer) {
      clearTimeout(noResultTimer);
      noResultTimer = null;
    }
    if (startTimeout) {
      clearTimeout(startTimeout);
      startTimeout = null;
    }
    if (micStreamRef) {
      micStreamRef.getTracks().forEach((t) => t.stop());
      micStreamRef = null;
    }
    if (recognition) {
      try { recognition.abort?.(); } catch (_) {}
      try { recognition.stop(); } catch (_) {}
      recognition = null;
      voiceState = VOICE_STATES.IDLE;
      lastVoiceStopAt = Date.now();
      if (clearError) micError = '';
      return;
    }
    voiceState = VOICE_STATES.IDLE;
    lastVoiceStopAt = Date.now();
    if (clearError) micError = '';
  }

  function handleSubmit() {
    const t = text.trim();
    if (!t || $isStreaming) return;
    inputError = '';
    // Always-on: do NOT stop the microphone on send; mic stays active (green).
    if ($settings.audio_enabled) playSend($settings.audio_volume);
    suggestionExpanded.set(null);
    const urls = images.map((f) => f.dataUrl);
    if (onSearchWeb && $webSearchForNextMessage) {
      webSearchForNextMessage.set(false);
      onSearchWeb(t);
      text = '';
      images = [];
      return;
    }
    onSend(t, urls);
    text = '';
    images = [];
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape') {
      if ($isStreaming) {
        ev.preventDefault();
        if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
        onStop?.();
      }
      return;
    }
    if (ev.key === 'Enter' && ev.ctrlKey) {
      ev.preventDefault();
      handleSubmit();
      return;
    }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      handleSubmit();
    }
  }

  function addImage(ev) {
    if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
    const files = ev.target.files;
    if (!files?.length) return;
    handleFiles(files);
    ev.target.value = '';
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    inputError = '';
    isFileProcessing = true;
    const modelId = $effectiveModelId ?? '';
    try {
      const { prepend, imageFiles } = await routeFiles(files, { modelId });
      if (prepend) text = (text ? text + '\n\n' : '') + prepend;
      for (const file of imageFiles) {
        const reader = new FileReader();
        reader.onload = () => {
          images = [...images, { file, dataUrl: reader.result }];
        };
        reader.readAsDataURL(file);
      }
    } catch (e) {
      console.warn('File handling error:', e);
      inputError = e?.message ?? 'File handling failed';
    } finally {
      isFileProcessing = false;
    }
  }

  async function handlePaste(ev) {
    const items = ev.clipboardData?.items;
    if (!items?.length) return;
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (file.type.startsWith('image/')) {
        ev.preventDefault();
        inputError = '';
        isFileProcessing = true;
        const modelId = $effectiveModelId ?? '';
        try {
          const result = await routeFile(file, { modelId });
          if (result?.prepend) {
            text = (text ? text + '\n\n' : '') + result.prepend;
          }
          if (result?.imageFile) {
            const reader = new FileReader();
            reader.onload = () => {
              images = [...images, { file: result.imageFile, dataUrl: reader.result }];
            };
            reader.readAsDataURL(result.imageFile);
          }
          if (result?.imageFiles) {
            for (const imgFile of result.imageFiles) {
              const reader = new FileReader();
              reader.onload = () => {
                images = [...images, { file: imgFile, dataUrl: reader.result }];
              };
              reader.readAsDataURL(imgFile);
            }
          }
        } catch (e) {
          console.warn('Paste image error:', e);
          inputError = e?.message ?? 'Paste failed';
        } finally {
          isFileProcessing = false;
        }
        return;
      }
    }
    const textPlain = ev.clipboardData?.getData('text/plain');
    if (textPlain?.trim()) {
      ev.preventDefault();
      inputError = '';
      text = (text ? text + '\n\n' : '') + textPlain;
    }
  }

  function handleDragOver(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = 'copy';
  }

  async function handleDrop(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const files = ev.dataTransfer?.files;
    if (!files?.length) return;
    if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
    await handleFiles(files);
  }

  function removeImage(index) {
    if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
    images = images.filter((_, i) => i !== index);
  }

  function doStartVoice(SpeechRecognition, isRetry = false, isAutoRestart = false) {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-US';
    rec.maxAlternatives = 3;

    rec.onresult = (ev) => {
      let latestInterim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const transcript = result[0]?.transcript?.trim();
        if (!transcript) continue;
        if (result.isFinal) {
          const prev = textRef.current;
          text = prev ? `${prev} ${transcript}` : transcript;
          latestInterim = '';
          lastResultAt = Date.now();
        } else {
          latestInterim = transcript;
          lastResultAt = Date.now();
        }
      }
      interimText = latestInterim;
      if (noResultTimer) {
        clearTimeout(noResultTimer);
        noResultTimer = null;
      }
    };

    rec.onend = () => {
      if (recognition !== rec) return;
      recognition = null;
      if (!userWantsMicOn) {
        voiceState = VOICE_STATES.IDLE;
        lastVoiceStopAt = Date.now();
        return;
      }
      voiceState = VOICE_STATES.LISTENING;
      const SR = typeof window !== 'undefined' && (window['SpeechRecognition'] || window['webkitSpeechRecognition']);
      if (SR) {
        setTimeout(() => {
          if (!userWantsMicOn) return;
          try {
            doStartVoice(SR, false, true);
          } catch (e) {
            voiceState = VOICE_STATES.ERROR;
            micError = 'Could not restart listening. Click mic to try again.';
          }
        }, 120);
      }
    };

    rec.onerror = (ev) => {
      if (ev.error === 'aborted') return;
      if (ev.error === 'no-speech') {
        micError = 'No speech detected. Keep speaking—still listening.';
        return;
      }
      if (ev.error === 'audio-capture') {
        micError = 'Microphone not available or in use by another app.';
        recognition = null;
        voiceState = VOICE_STATES.ERROR;
        lastVoiceStopAt = Date.now();
        return;
      }
      if (ev.error === 'network') {
        micError = 'Speech service error. Check your internet connection.';
        recognition = null;
        voiceState = VOICE_STATES.ERROR;
        lastVoiceStopAt = Date.now();
        return;
      }
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        micError = 'Microphone access was blocked. Allow access and click the mic again.';
        recognition = null;
        voiceState = VOICE_STATES.ERROR;
        lastVoiceStopAt = Date.now();
        return;
      }
      micError = 'Speech recognition error. Click the mic to try again.';
      recognition = null;
      voiceState = VOICE_STATES.ERROR;
      lastVoiceStopAt = Date.now();
    };

    rec.onsoundstart = () => {
      lastResultAt = Date.now();
      if (noResultTimer) {
        clearTimeout(noResultTimer);
        noResultTimer = null;
      }
    };

    rec.onsoundend = () => {
      if (voiceState !== VOICE_STATES.LISTENING) return;
      if (noResultTimer) clearTimeout(noResultTimer);
      noResultTimer = setTimeout(() => {
        if (voiceState !== VOICE_STATES.LISTENING) return;
        micError = 'No speech detected. Still listening—keep speaking or click mic to turn off.';
      }, 8000);
    };

    rec.onstart = () => {
      if (startTimeout) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }
      voiceState = VOICE_STATES.LISTENING;
      lastResultAt = Date.now();
      noResultTimer = setTimeout(() => {
        if (voiceState !== VOICE_STATES.LISTENING) return;
        micError = 'No speech yet. Speak into the mic or click Retry.';
      }, 8000);
    };

    rec.onaudiostart = () => {
      if (voiceState === VOICE_STATES.STARTING) voiceState = VOICE_STATES.LISTENING;
    };

    recognition = rec;
    if (isAutoRestart) {
      try {
        rec.start();
      } catch (e) {
        recognition = null;
        voiceState = VOICE_STATES.ERROR;
        micError = 'Could not restart listening. Click mic to try again.';
      }
      return;
    }
    const startTimeoutMs = isRetry ? 4000 : 2500;
    startTimeout = setTimeout(() => {
      startTimeout = null;
      if (voiceState === VOICE_STATES.STARTING && recognition === rec) {
        try { rec.abort?.(); } catch (_) {}
        try { rec.stop(); } catch (_) {}
        recognition = null;
        voiceState = isRetry ? VOICE_STATES.ERROR : VOICE_STATES.IDLE;
        if (isRetry) {
          micError = 'Mic did not connect. Try closing other tabs using the mic, then click again.';
        } else {
          setTimeout(() => {
            if (voiceState !== VOICE_STATES.IDLE || recognition) return;
            doStartVoice(SpeechRecognition, true);
          }, 700);
        }
      }
    }, startTimeoutMs);

    try {
      rec.start();
    } catch (e) {
      if (startTimeout) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }
      recognition = null;
      voiceState = VOICE_STATES.ERROR;
      micError = 'Could not start speech recognition. Allow mic access and try again.';
    }
  }

  function toggleVoice() {
    if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
    if (isListening) {
      stopVoice();
      return;
    }
    const SpeechRecognition = typeof window !== 'undefined' && (window['SpeechRecognition'] || window['webkitSpeechRecognition']);
    if (!SpeechRecognition) {
      micError = 'Speech recognition not supported in this browser. Try Chrome or Edge.';
      voiceState = VOICE_STATES.ERROR;
      return;
    }
    if (Date.now() - lastVoiceStopAt < VOICE_COOLDOWN_MS) return;
    userWantsMicOn = true;
    voiceState = VOICE_STATES.STARTING;
    micError = '';
    doStartVoice(SpeechRecognition);
  }

  function restartVoice() {
    stopVoice();
    setTimeout(() => {
      if (voiceState === VOICE_STATES.IDLE) toggleVoice();
    }, 600);
  }
</script>

<div class="flex flex-col gap-3">
  {#if images.length}
    <div class="flex flex-wrap gap-2">
      {#each images as img, i}
        <div class="relative inline-block">
          <img src={img.dataUrl} alt="Attach" class="h-16 w-16 object-cover rounded-xl border border-zinc-200 dark:border-zinc-600" />
          <button
            type="button"
            class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600"
            onclick={() => removeImage(i)}
            aria-label="Remove image">
            ×
          </button>
        </div>
      {/each}
    </div>
  {/if}
  <div
    class="flex flex-col gap-0 rounded-2xl border shadow-md ui-input-glow transition-all duration-150"
    class:ui-input-breathe={!$isStreaming && !isListening && !text.trim() && images.length === 0}
    style="background-color: var(--ui-input-bg); border-color: var(--ui-input-border);"
    role="presentation"
    ondragover={handleDragOver}
    ondrop={handleDrop}
    onpaste={handlePaste}>
    <div class="flex gap-2 items-end">
    <input
      type="file"
      accept="image/*,.pdf,.txt,.py"
      multiple
      class="hidden"
      id="img-upload"
      onchange={addImage} />
    <button
      type="button"
      class="shrink-0 p-3 rounded-xl text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      title="Attach image, PDF, or text file"
      aria-label="Attach file (image, PDF, .txt, .py)"
      onclick={() => {
        if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
        document.getElementById('img-upload')?.click();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
          document.getElementById('img-upload')?.click();
        }
      }}>
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
    </button>
    <button
      type="button"
      class="shrink-0 p-3 rounded-xl transition-colors {isListening ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : micStarting ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 animate-pulse' : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 hover:text-zinc-600 dark:hover:text-zinc-300'}"
      onclick={toggleVoice}
      disabled={voiceState === VOICE_STATES.STARTING}
      title={micTitle}
      aria-label={micTitle}>
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
    </button>
    {#if onSearchWeb}
      <button
        type="button"
        class="shrink-0 p-3 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed {$webSearchForNextMessage ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400' : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 hover:text-zinc-600 dark:hover:text-zinc-300'}"
        onclick={() => {
          if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
          webSearchForNextMessage.update((v) => !v);
        }}
        disabled={$isStreaming}
        title="{$webSearchForNextMessage ? 'Web search ON – your next send will search the web' : 'Include web search for this message (toggle on, then type and send)'}"
        aria-label="{$webSearchForNextMessage ? 'Web search on' : 'Include web search'}">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </button>
    {/if}
    <div class="flex-1 min-w-0 border-l border-zinc-200 dark:border-zinc-600/80 pl-1 flex flex-col min-h-0">
      <textarea
        bind:value={text}
        onkeydown={onKeydown}
        placeholder="{$webSearchForNextMessage ? 'Type your question… then click Send to search the web' : 'Submit your question here...'}"
        rows="1"
        class="w-full min-h-[48px] max-h-[min(50vh,400px)] resize-y bg-transparent px-3 py-3 focus:outline-none text-[15px] overflow-y-auto"
        style="color: var(--ui-text-primary);"
        disabled={$isStreaming}></textarea>
    </div>
    {#if $isStreaming}
      <button
        type="button"
        class="shrink-0 m-1.5 w-12 h-12 rounded-full text-white transition-colors flex items-center justify-center"
        style="background-color: var(--ui-accent-hot);"
        onclick={() => { if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume); onStop?.(); }}
        aria-label="Stop generating"
        title="Stop generating">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
      </button>
    {:else}
      <button
        type="button"
        class="shrink-0 m-1.5 w-12 h-12 rounded-full ui-btn-accent flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
        style="color: var(--ui-bg-main);"
        onclick={handleSubmit}
        disabled={!text.trim()}
        title="Send">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
      </button>
    {/if}
    </div>
    {#if $suggestionExpanded?.options?.length}
      <div class="border-t border-zinc-200 dark:border-zinc-600/80 px-3 py-2.5 flex flex-col gap-1">
        {#each $suggestionExpanded.options as option}
          <button
            type="button"
            class="w-full text-left text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 rounded-lg px-3 py-2 transition-colors"
            onclick={() => pickElaboration(option)}>
            {option}
          </button>
        {/each}
      </div>
    {/if}
    {#if $webSearchInProgress}
      <div class="px-3 py-2.5 flex items-center gap-2 border-t shrink-0 animate-pulse" style="border-color: var(--ui-border); background: color-mix(in srgb, var(--atom-teal) 18%, transparent); color: var(--ui-text-primary);">
        <svg class="animate-spin h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <span class="text-xs font-medium">Searching the web…</span>
      </div>
    {/if}
    {#if isFileProcessing}
      <div class="px-3 py-2 flex items-center gap-2 border-t shrink-0" style="border-color: var(--ui-border); background: color-mix(in srgb, var(--ui-accent) 10%, transparent); color: var(--ui-text-secondary);">
        <svg class="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <span class="text-xs">Processing file...</span>
      </div>
    {/if}
    {#if inputError}
      <div class="px-3 py-2 flex items-center justify-between gap-3 border-t shrink-0" style="border-color: var(--ui-border); background: color-mix(in srgb, var(--ui-accent-hot) 12%, transparent); color: var(--ui-text-primary);">
        <span class="text-xs min-w-0 break-words">{inputError}</span>
        <button
          type="button"
          class="shrink-0 text-xs px-2 py-1 rounded border hover:opacity-90"
          style="border-color: var(--ui-border);"
          onclick={() => (inputError = '')}
          aria-label="Dismiss error">Dismiss</button>
      </div>
    {/if}
    {#if isListening || micError || micStarting}
      <div class="px-3 pb-2 text-xs flex items-center justify-between gap-3" style="color: var(--ui-text-secondary);">
        <div class="min-w-0">
          {#if micStarting}
            <span class="text-amber-600 dark:text-amber-400 font-medium">Starting mic…</span>
          {:else if isListening}
            <span class="text-green-600 dark:text-green-400 font-medium">Listening…</span>
            {#if interimText}
              <span class="ml-2 italic">"{interimText}"</span>
            {/if}
          {/if}
          {#if micError}
            <span class="ml-2 text-red-600 dark:text-red-400">{micError}</span>
          {/if}
        </div>
        {#if micError}
          <button
            type="button"
            class="shrink-0 text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700"
            onclick={restartVoice}>
            Retry mic
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
