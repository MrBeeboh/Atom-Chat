<script>
  import { grokApiKey, settings, settingsOpen, settingsFocus } from '$lib/stores.js';
  import { addMessage } from '$lib/db.js';
  import { GrokVoiceSession, XAI_VOICES, DEFAULT_ROLEPLAY_INSTRUCTIONS } from '$lib/grokVoice.js';
  import { stopTts } from '$lib/tts.js';
  import { voiceRoleplaySessionActive, ttsActiveMessageId, ttsReadAloudEnabled } from '$lib/stores.js';
  import ThinkingAtom from '$lib/components/ThinkingAtom.svelte';

  let {
    open = $bindable(false),
    conversationId = '',
    onMessagesAdded = () => {},
  } = $props();

  const SCENARIO_KEY = 'voiceRoleplayScenario';
  const VOICE_KEY = 'xaiVoiceRoleplayVoice';

  let scenario = $state('');
  let voice = $state('eve');
  let session = $state(/** @type {GrokVoiceSession | null} */ (null));
  let state = $state(/** @type {'idle'|'connecting'|'connected'|'listening'|'speaking'|'disconnected'|'error'} */ ('idle'));
  let error = $state(/** @type {string | null} */ (null));
  let liveLines = $state(/** @type {{ role: 'user' | 'assistant', text: string, live?: boolean }[]} */ ([]));
  let pendingUser = $state('');
  let pendingAssistant = $state('');
  let audioChunks = $state(0);
  /** Modal hidden but Eve still running */
  let docked = $state(false);
  /** Conversation id locked for the active voice session */
  let sessionConversationId = $state('');

  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    scenario = localStorage.getItem(SCENARIO_KEY) || '';
    voice = localStorage.getItem(VOICE_KEY) || 'eve';
  });

  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SCENARIO_KEY, scenario);
  });

  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(VOICE_KEY, voice);
  });

  const hasKey = $derived(!!($grokApiKey?.trim() || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GROK_API_KEY)));
  const voiceLabel = $derived(XAI_VOICES.find((v) => v.id === voice)?.label ?? 'Eve');
  const sessionActive = $derived(session != null);
  const showModal = $derived(open && !docked);
  const showDock = $derived(sessionActive && docked);

  const stateLabel = $derived(
    ({
      idle: 'Ready',
      connecting: 'Connecting…',
      connected: 'Connected — speak to begin',
      listening: 'Listening…',
      speaking: `${voiceLabel} is speaking…`,
      disconnected: 'Session ended',
      error: 'Error',
    })[state] ?? state,
  );

  const dockStatusColor = $derived(
    state === 'listening' ? '#22c55e' : state === 'speaking' ? '#a855f7' : state === 'connecting' ? '#eab308' : state === 'error' ? '#ef4444' : '#94a3b8',
  );

  function getApiKey() {
    return ($grokApiKey?.trim() || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GROK_API_KEY) || '').trim();
  }

  async function persistMessage(role, content) {
    const conv = sessionConversationId || conversationId;
    if (!conv || !content?.trim()) return;
    await addMessage(conv, {
      role,
      content: content.trim(),
      modelId: `grok-voice:${voice}`,
    });
    onMessagesAdded();
  }

  async function startSession() {
    error = null;
    liveLines = [];
    pendingUser = '';
    pendingAssistant = '';
    audioChunks = 0;
    docked = false;
    sessionConversationId = conversationId || '';
    const apiKey = getApiKey();
    if (!apiKey) {
      error = 'Add your Grok (xAI) API key in Settings first.';
      return;
    }

    const s = new GrokVoiceSession({
      onState: (st) => {
        state = st;
        if (st === 'listening' || st === 'speaking' || st === 'connected') {
          voiceRoleplaySessionActive.set(true);
          error = null;
        } else if (st === 'connecting') {
          error = null;
        } else if (st === 'disconnected' || st === 'error') {
          voiceRoleplaySessionActive.set(false);
          session = null;
          docked = false;
        }
      },
      onUserTranscript: async (text) => {
        pendingUser = text;
        liveLines = [...liveLines.filter((l) => !l.live || l.role !== 'user'), { role: 'user', text }];
        await persistMessage('user', text);
        pendingUser = '';
      },
      onAssistantTranscriptDelta: (_delta, full) => {
        pendingAssistant = full;
        const withoutLive = liveLines.filter((l) => !(l.live && l.role === 'assistant'));
        liveLines = [...withoutLive, { role: 'assistant', text: full, live: true }];
      },
      onAssistantTranscriptDone: async (text) => {
        pendingAssistant = '';
        liveLines = liveLines.map((l) => (l.live && l.role === 'assistant' ? { role: 'assistant', text } : l));
        await persistMessage('assistant', text);
        liveLines = liveLines.map((l) => ({ ...l, live: false }));
      },
      onAudioChunks: (n) => {
        audioChunks = n;
      },
      onError: (err) => {
        error = err instanceof Error ? err.message : String(err);
        state = 'error';
      },
    });

    session = s;
    stopTts();
    ttsActiveMessageId.set(null);
    ttsReadAloudEnabled.set(false);
    try {
      const instructions = ($settings?.system_prompt || '').trim() || DEFAULT_ROLEPLAY_INSTRUCTIONS;
      await s.connect({ apiKey, instructions, scenario, voice });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      state = 'error';
      session = null;
      docked = false;
      voiceRoleplaySessionActive.set(false);
    }
  }

  function stopSession() {
    stopTts();
    ttsActiveMessageId.set(null);
    voiceRoleplaySessionActive.set(false);
    session?.disconnect();
    session = null;
    state = 'idle';
    docked = false;
    open = false;
    pendingUser = '';
    pendingAssistant = '';
    sessionConversationId = '';
  }

  function minimizePanel() {
    if (!sessionActive) {
      open = false;
      return;
    }
    docked = true;
    open = false;
  }

  function expandPanel() {
    docked = false;
    open = true;
  }

  function dismissPanel() {
    if (sessionActive) {
      minimizePanel();
      return;
    }
    open = false;
    docked = false;
  }

  function openSettingsForKey() {
    settingsFocus.set('api-keys');
    settingsOpen.set(true);
  }

  /** Last assistant line for dock preview */
  const dockPreview = $derived(
    [...liveLines].reverse().find((l) => l.role === 'assistant')?.text?.slice(0, 80) ?? '',
  );

  /** Re-open from chat bar while docked → expand full panel */
  $effect(() => {
    if (open && docked) docked = false;
  });
</script>

{#if showModal}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="voice-roleplay-title"
  >
    <button
      type="button"
      class="absolute inset-0 bg-black/50"
      aria-label="Minimize voice roleplay"
      onclick={dismissPanel}
    ></button>

    <div
      class="relative w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
      style="background: var(--ui-bg-sidebar); border: 1px solid var(--ui-border);"
    >
      <header class="px-5 py-4 shrink-0" style="border-bottom: 1px solid var(--ui-border);">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 id="voice-roleplay-title" class="text-lg font-semibold" style="color: var(--ui-accent);">
              Voice roleplay — {voiceLabel}
            </h2>
            <p class="text-xs mt-1" style="color: var(--ui-text-secondary);">
              xAI Grok Voice (cloud) — not the header model. Read-aloud on chat messages pauses while Eve is active. Use headphones if Eve's voice is silent.
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            {#if sessionActive}
              <button
                type="button"
                class="rounded-lg px-2 py-1 text-sm"
                style="color: var(--ui-text-secondary);"
                onclick={minimizePanel}
                title="Minimize — keep Eve running"
                aria-label="Minimize"
              >−</button>
            {/if}
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-sm"
              style="color: var(--ui-text-secondary);"
              onclick={dismissPanel}
              aria-label={sessionActive ? 'Minimize' : 'Close'}
            >✕</button>
          </div>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
        {#if !hasKey}
          <div class="rounded-lg px-4 py-3 text-sm" style="background: color-mix(in srgb, #ef4444 12%, transparent); color: var(--ui-text-primary);">
            Grok (xAI) API key required.
            <button type="button" class="underline ml-1" onclick={openSettingsForKey}>Open Settings</button>
          </div>
        {/if}

        <div>
          <label for="voice-roleplay-voice" class="block text-xs font-semibold uppercase tracking-wide mb-1.5" style="color: var(--ui-text-secondary);">Voice</label>
          <select
            id="voice-roleplay-voice"
            class="w-full rounded-lg px-3 py-2 text-sm border"
            style="background: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
            bind:value={voice}
            disabled={sessionActive}
          >
            {#each XAI_VOICES as v}
              <option value={v.id}>{v.label} — {v.description}</option>
            {/each}
          </select>
        </div>

        <div>
          <label for="voice-roleplay-scenario" class="block text-xs font-semibold uppercase tracking-wide mb-1.5" style="color: var(--ui-text-secondary);">
            Scenario &amp; character notes
          </label>
          <textarea
            id="voice-roleplay-scenario"
            class="w-full rounded-lg px-3 py-2 text-sm border min-h-[5rem] resize-y"
            style="background: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border);"
            placeholder="e.g. You are a mysterious guide in a fantasy tavern. The user is a weary traveler seeking rumors about the lost city."
            bind:value={scenario}
            disabled={sessionActive}
          ></textarea>
          <p class="text-[11px] mt-1" style="color: var(--ui-text-secondary);">
            Combined with your system prompt (Intel panel / preset). Use headphones if Eve's voice is silent.
          </p>
        </div>

        <div class="rounded-xl px-4 py-3 min-h-[8rem]" style="background: var(--ui-bg-main); border: 1px solid var(--ui-border);">
          <div class="flex items-center gap-2 mb-3">
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0"
              style="background: {dockStatusColor};"
            ></span>
            <span class="text-sm font-medium" style="color: var(--ui-text-primary);">{stateLabel}</span>
            {#if audioChunks > 0}
              <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, var(--ui-accent) 12%, transparent); color: var(--ui-accent);">{audioChunks} audio chunks</span>
            {/if}
            {#if state === 'connecting' || state === 'speaking'}
              <ThinkingAtom size={14} />
            {/if}
          </div>

          {#if liveLines.length === 0 && !pendingUser && !pendingAssistant}
            <p class="text-sm italic" style="color: var(--ui-text-secondary);">
              Start a session and speak naturally. Eve responds in voice; lines appear here as transcripts.
            </p>
          {:else}
            <div class="space-y-2 text-sm">
              {#each liveLines as line, i (i)}
                <p style="color: {line.role === 'user' ? 'var(--ui-text-primary)' : 'var(--ui-accent)'};">
                  <span class="font-semibold">{line.role === 'user' ? 'You' : voiceLabel}:</span>
                  {line.text}{line.live ? '…' : ''}
                </p>
              {/each}
            </div>
          {/if}
        </div>

        {#if error}
          <p class="text-sm rounded-lg px-3 py-2" style="background: color-mix(in srgb, #ef4444 10%, transparent); color: #ef4444;">{error}</p>
        {/if}
      </div>

      <footer class="px-5 py-4 flex gap-2 shrink-0" style="border-top: 1px solid var(--ui-border);">
        {#if sessionActive}
          <button
            type="button"
            class="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style="background: color-mix(in srgb, #ef4444 18%, transparent); color: #ef4444;"
            onclick={stopSession}
          >
            End session
          </button>
          <button
            type="button"
            class="rounded-xl px-4 py-2.5 text-sm font-medium"
            style="border: 1px solid var(--ui-border); color: var(--ui-text-secondary);"
            onclick={minimizePanel}
          >
            Minimize
          </button>
        {:else}
          <button
            type="button"
            class="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
            style="background: var(--ui-accent); color: var(--ui-bg-main);"
            disabled={!hasKey}
            onclick={startSession}
          >
            Start voice roleplay
          </button>
          <button
            type="button"
            class="rounded-xl px-4 py-2.5 text-sm font-medium"
            style="border: 1px solid var(--ui-border); color: var(--ui-text-secondary);"
            onclick={dismissPanel}
          >
            Close
          </button>
        {/if}
      </footer>
    </div>
  </div>
{/if}

{#if showDock}
  <div
    class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm shadow-2xl rounded-2xl overflow-hidden"
    style="background: var(--ui-bg-sidebar); border: 1px solid var(--ui-border);"
    role="region"
    aria-label="Eve voice roleplay dock"
  >
    <div class="flex items-center gap-2 px-4 py-3" style="border-bottom: 1px solid var(--ui-border);">
      <span class="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse" style="background: {dockStatusColor};"></span>
      <span class="text-sm font-semibold truncate" style="color: var(--ui-accent);">{voiceLabel}</span>
      <span class="text-xs truncate" style="color: var(--ui-text-secondary);">{stateLabel}</span>
      <div class="ml-auto flex items-center gap-1 shrink-0">
        <button
          type="button"
          class="rounded-lg px-2 py-1 text-xs font-medium"
          style="color: var(--ui-text-secondary); border: 1px solid var(--ui-border);"
          onclick={expandPanel}
          title="Expand panel"
        >Expand</button>
        <button
          type="button"
          class="rounded-lg px-2 py-1 text-xs font-medium"
          style="color: #ef4444;"
          onclick={stopSession}
          title="End Eve session"
        >End</button>
      </div>
    </div>
    {#if dockPreview}
      <p class="px-4 pb-3 text-xs line-clamp-2" style="color: var(--ui-text-secondary);">
        <span style="color: var(--ui-accent);">{voiceLabel}:</span> {dockPreview}{dockPreview.length >= 80 ? '…' : ''}
      </p>
    {/if}
  </div>
{/if}
