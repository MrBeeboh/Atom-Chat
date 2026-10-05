<script>
  import { get } from 'svelte/store';
  import { activeConversationId, activeMessages, conversations, settings, effectiveModelId, isStreaming, chatError, chatCommand, insertChatPrompt, pendingDroppedFiles, webSearchInProgress, webSearchConnected, grokApiKey, deepinfraApiKey, confirm, contextUsage, summarizeAndContinueTrigger, models } from '$lib/stores.js';
  import SetupGuide from '$lib/components/SetupGuide.svelte';
  import { deriveSetupStatus } from '$lib/connectionSetup.js';
  import { getMessages, addMessage, clearMessages, deleteMessage, getMessageCount, updateConversation, listConversations } from '$lib/db.js';
  import { streamChatCompletion, requestChatCompletion, requestGrokImageGeneration, requestDeepInfraImageGeneration, requestDeepInfraVideoGeneration, isGrokModel, isDeepSeekModel, decodeTokPerSec, probeLocalContextSize, isQwen38FlashNextSelection, flashNextHasVision } from '$lib/api.js';
  import { pickThinkingOptions } from '$lib/thinkingControls.js';
  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import AtomLogo from '$lib/components/AtomLogo.svelte';
  import { generateId, resizeImageDataUrlsForVision, shouldSkipImageResizeForVision, messageContentToText } from '$lib/utils.js';
  import { listedModelCaps } from '$lib/modelCapabilities.js';
  import { modelPricingCatalog } from '$lib/modelPricing.js';
  import { maybeReadAloudAssistantReply } from '$lib/tts.js';
  import {
    DESKTOP_TOOLS,
    MAX_DESKTOP_TOOL_ROUNDS,
    desktopSystemHint,
    mergeSystemHint,
    foldSystemIntoUserMessages,
    repairOpenAiToolTurns,
    fetchDesktopHostStatus,
    executeDesktopToolCalls,
    formatToolStatus,
  } from '$lib/desktopHost.js';
  import {
    WEB_SEARCH_TOOLS,
    WEB_SEARCH_HINT,
    GROK_WEB_SEARCH_HINT,
    isWebSearchToolName,
    executeWebSearchToolCalls,
  } from '$lib/webSearch.js';
  import { buildChatApiMessages } from '$lib/deepSeekCache.js';
  import { estimateMessagesTokens, fitMessagesToContext, needsCompress, splitHeadForCompress, transcriptForSummary } from '$lib/chatContext.js';

  const convId = $derived($activeConversationId);
  let chatAbortController = $state(null);
  let imageGenerating = $state(false);
  let compressing = $state(false);
  /** Once Documents tools are used on a conversation, keep the same tool schema + hint. */
  const desktopToolsPin = new Map();

  $effect(() => {
    const msgs = $activeMessages || [];
    const model = $effectiveModelId;
    const tokens = estimateMessagesTokens(msgs);
    let cancelled = false;
    (async () => {
      const nCtx = model && !String(model).includes(':') ? await probeLocalContextSize() : 128000;
      if (!cancelled) contextUsage.set({ promptTokens: tokens, contextMax: nCtx });
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const tick = $summarizeAndContinueTrigger;
    if (!tick) return;
    compressConversation();
  });

  /** Welcome line on empty chat: one prompt, chosen on mount, fades in to feel alive. */
  const WELCOME_PROMPTS = [
    'Ask me anything!',
    "What's on your mind?",
    'How can I assist you today?',
    "What would you like to explore?",
    "I'm here to help — just ask.",
  ];

  const STARTER_PROMPTS = [
    'Explain this in simple terms:',
    'Help me debug this error:',
    'Summarize the key points of:',
    'Write a short, professional email about:',
  ];

  function useStarterPrompt(prompt) {
    insertChatPrompt.set({ text: prompt, ts: Date.now() });
  }
  let welcomeLine = $state(null);
  $effect(() => {
    if ($activeMessages?.length > 0) {
      welcomeLine = null;
      return;
    }
    const id = setTimeout(() => {
      welcomeLine = WELCOME_PROMPTS[Math.floor(Math.random() * WELCOME_PROMPTS.length)];
    }, 400);
    return () => clearTimeout(id);
  });

  /** Image engines currently listed on DeepInfra, plus Grok Imagine. `model` is the API id. */
  const ENGINE_OPTIONS = [
    { label: 'FLUX.1 Schnell', model: 'black-forest-labs/FLUX-1-schnell', type: 'deepinfra' },
    { label: 'FLUX.1 Dev', model: 'black-forest-labs/FLUX-1-dev', type: 'deepinfra' },
    { label: 'FLUX 1.1 Pro', model: 'black-forest-labs/FLUX-1.1-pro', type: 'deepinfra' },
    { label: 'FLUX 2 Klein 4B', model: 'black-forest-labs/FLUX-2-klein-4b', type: 'deepinfra' },
    { label: 'FLUX 2 Klein 9B', model: 'black-forest-labs/FLUX-2-klein-9b', type: 'deepinfra' },
    { label: 'FLUX 2 Pro', model: 'black-forest-labs/FLUX-2-pro', type: 'deepinfra' },
    { label: 'Seedream 4', model: 'ByteDance/Seedream-4', type: 'deepinfra' },
    { label: 'Seedream 4.5', model: 'ByteDance/Seedream-4.5', type: 'deepinfra' },
    { label: 'Wan 2.6 T2I', model: 'Wan-AI/Wan2.6-T2I', type: 'deepinfra' },
    { label: 'Pruna P-Image', model: 'PrunaAI/p-image', type: 'deepinfra' },
    { label: 'SDXL Turbo', model: 'stabilityai/sdxl-turbo', type: 'deepinfra' },
    { label: 'Grok Imagine (fast)', model: 'grok-imagine-image', type: 'grok' },
    { label: 'Grok Imagine Pro (HQ)', model: 'grok-imagine-image-pro', type: 'grok' },
    { label: 'Grok Imagine Quality', model: 'grok-imagine-image-quality', type: 'grok' },
  ];
  const STEP_OPTIONS_PER_ENGINE = [
    [{ label: 'Minimal', steps: 1 }, { label: 'Quick', steps: 2 }, { label: 'Standard', steps: 4 }],
    [{ label: 'Quick', steps: 20 }, { label: 'Standard', steps: 25 }, { label: 'Detailed', steps: 30 }, { label: 'High Detail', steps: 50 }],
    [{ label: 'Quick', steps: 20 }, { label: 'Standard', steps: 25 }, { label: 'Detailed', steps: 30 }],
    [{ label: 'Minimal', steps: 1 }, { label: 'Quick', steps: 2 }, { label: 'Standard', steps: 4 }],
    [{ label: 'Quick', steps: 4 }, { label: 'Standard', steps: 6 }, { label: 'Detailed', steps: 8 }],
    [{ label: 'Standard', steps: 25 }, { label: 'Detailed', steps: 30 }, { label: 'High Detail', steps: 50 }],
    [{ label: 'Standard', steps: 25 }, { label: 'Detailed', steps: 30 }, { label: 'High Detail', steps: 50 }],
    [{ label: 'Standard', steps: 25 }, { label: 'Detailed', steps: 30 }, { label: 'High Detail', steps: 50 }],
    [{ label: 'Quick', steps: 20 }, { label: 'Standard', steps: 25 }, { label: 'Detailed', steps: 30 }],
    [{ label: 'Standard', steps: 1 }],
    [{ label: 'Quick', steps: 1 }, { label: 'Standard', steps: 2 }, { label: 'Detailed', steps: 4 }],
    [{ label: '1K (Fast)', resolution: '1k' }, { label: '2K (HQ)', resolution: '2k' }],
    [{ label: '1K (Fast)', resolution: '1k' }, { label: '2K (HQ)', resolution: '2k' }],
    [{ label: '1K (Fast)', resolution: '1k' }, { label: '2K (HQ)', resolution: '2k' }],
  ];
  const SIZE_OPTIONS_PER_ENGINE = [
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Portrait', width: 1152, height: 896 }, { label: 'Landscape', width: 896, height: 1152 }, { label: 'Wide', width: 1280, height: 768 }],
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Portrait', width: 1152, height: 896 }, { label: 'Wide', width: 1344, height: 768 }, { label: 'Panoramic', width: 1728, height: 1152 }],
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Wide', width: 1344, height: 768 }, { label: 'Panoramic', width: 1820, height: 1024 }],
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Portrait', width: 768, height: 1024 }, { label: 'Landscape', width: 1024, height: 768 }],
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Portrait', width: 768, height: 1024 }, { label: 'Wide', width: 1344, height: 768 }],
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Wide', width: 1344, height: 768 }, { label: 'Panoramic', width: 1820, height: 1024 }],
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Portrait', width: 768, height: 1024 }, { label: 'Landscape', width: 1024, height: 768 }],
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Portrait', width: 768, height: 1024 }, { label: 'Landscape', width: 1024, height: 768 }],
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Portrait', width: 1152, height: 896 }, { label: 'Wide', width: 1344, height: 768 }],
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Portrait', width: 1152, height: 896 }, { label: 'Wide', width: 1344, height: 768 }],
    [{ label: '1:1 Square', width: 1024, height: 1024 }, { label: 'Portrait', width: 1152, height: 896 }, { label: 'Landscape', width: 896, height: 1152 }],
    [{ label: '1:1 Square', aspect_ratio: '1:1' }, { label: 'Portrait', aspect_ratio: '3:4' }, { label: 'Landscape', aspect_ratio: '4:3' }, { label: 'Wide', aspect_ratio: '16:9' }],
    [{ label: '1:1 Square', aspect_ratio: '1:1' }, { label: 'Portrait', aspect_ratio: '3:4' }, { label: 'Landscape', aspect_ratio: '4:3' }, { label: 'Wide', aspect_ratio: '16:9' }],
    [{ label: '1:1 Square', aspect_ratio: '1:1' }, { label: 'Portrait', aspect_ratio: '3:4' }, { label: 'Landscape', aspect_ratio: '4:3' }, { label: 'Wide', aspect_ratio: '16:9' }],
  ];
  const N_OPTIONS = [1, 2, 4];
  let imageModalOpen = $state(false);
  let imageModalPrompt = $state('');
  let imageModalEngine = $state(0);
  let imageModalQuality = $state(2);
  let imageModalSize = $state(0);
  let imageModalN = $state(0);
  const imageModalQualityOptions = $derived(STEP_OPTIONS_PER_ENGINE[imageModalEngine] ?? STEP_OPTIONS_PER_ENGINE[0]);
  const imageModalSizeOptions = $derived(SIZE_OPTIONS_PER_ENGINE[imageModalEngine] ?? SIZE_OPTIONS_PER_ENGINE[0]);
  const canGenerateImage = $derived(imageModalPrompt.trim().length > 0);

  const viteDeepinfraKey = (import.meta.env.VITE_DEEPINFRA_API_KEY || '').trim();
  const viteGrokKey = (import.meta.env.VITE_GROK_API_KEY || '').trim();
  const deepinfraKey = $derived(($deepinfraApiKey ?? '').trim() || viteDeepinfraKey);
  const grokKeyPresent = $derived(!!(($grokApiKey ?? '').trim() || viteGrokKey));
  const canOfferImage = $derived(deepinfraKey.length > 0 || grokKeyPresent);
  const canOfferVideo = $derived(deepinfraKey.length > 0);
  const getDeepinfraImageKey = () => (get(deepinfraApiKey)?.trim() || viteDeepinfraKey);
  const getGrokImageKey = () => (get(grokApiKey)?.trim() || viteGrokKey);

  /** Video modal (DeepInfra). Per spec: prompt only; no other params. */
  const VIDEO_ENGINE_OPTIONS = [
    { label: 'Wan 2.2 A14B', modelId: 'Wan-AI/Wan2.2-T2V-A14B' },
    { label: 'Wan 2.6 T2V', modelId: 'Wan-AI/Wan2.6-T2V' },
    { label: 'Pixverse HD', modelId: 'Pixverse/Pixverse-T2V-HD' },
    { label: 'Veo 3.1 Fast', modelId: 'google/veo-3.1-fast' },
  ];
  let videoModalOpen = $state(false);
  let videoModalPrompt = $state('');
  let videoModalEngine = $state(0);
  let videoGenerating = $state(false);
  let videoGenStartMs = $state(0);
  let videoGenElapsed = $state('');
  let videoGenTimerId = $state(null);

  $effect(() => {
    if (videoGenerating) {
      videoGenStartMs = Date.now();
      videoGenElapsed = '0:00';
      videoGenTimerId = setInterval(() => {
        const sec = Math.floor((Date.now() - videoGenStartMs) / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        videoGenElapsed = `${m}:${s.toString().padStart(2, '0')}`;
      }, 1000);
    } else {
      if (videoGenTimerId) clearInterval(videoGenTimerId);
      videoGenTimerId = null;
      videoGenElapsed = '';
    }
  });

  $effect(() => {
    const qOpts = imageModalQualityOptions;
    const qMax = qOpts.length - 1;
    if (qMax >= 0 && imageModalQuality > qMax) imageModalQuality = qMax;
    const sOpts = imageModalSizeOptions;
    const sMax = sOpts.length - 1;
    if (sMax >= 0 && imageModalSize > sMax) imageModalSize = sMax;
  });

  async function loadMessages(id = convId) {
    if (!id) {
      activeMessages.set([]);
      return;
    }
    const msgs = await getMessages(id);
    activeMessages.set(msgs);
  }

  $effect(() => {
    loadMessages(convId);
  });

  $effect(() => {
    const cmd = $chatCommand;
    if (!cmd?.type || !convId) return;
    if (cmd.type === 'clear') {
      clearChat();
    } else if (cmd.type === 'export') {
      exportChat();
    } else if (cmd.type === 'regenerate') {
      regenerateLast();
    }
    chatCommand.set(null);
  });

  async function exportChat() {
    if (!convId) return;
    const msgs = await getMessages(convId);
    const lines = msgs.map((m) => `**${m.role}:**\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n---\n\n');
    const blob = new Blob([lines], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${convId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Strip prior-turn images (size). DeepSeek keeps assistant thinking so the KV prefix matches. */
  function buildApiMessages(msgs, systemPrompt) {
    return buildChatApiMessages({
      msgs,
      systemPrompt,
      stripAssistantThinking: !isDeepSeekModel($effectiveModelId),
    });
  }

  /**
   * Replace older turns with one compact note so the live window stays usable.
   * @returns {Promise<boolean>}
   */
  async function compressConversation() {
    if (compressing || $isStreaming || !convId) return false;
    const model = $effectiveModelId;
    if (!model) return false;
    const history = await getMessages(convId);
    const nCtx = String(model).includes(':') ? 128000 : await probeLocalContextSize();
    const tokens = estimateMessagesTokens(history);
    if (!needsCompress(tokens, nCtx) && history.length < 8) return false;
    const { head } = splitHeadForCompress(history, { nCtx });
    if (!head.length) return false;
    compressing = true;
    chatError.set('Compressing earlier turns…');
    try {
      let transcript = transcriptForSummary(head, messageContentToText);
      const maxChars = Math.max(2000, Math.floor(nCtx * 2.5));
      if (transcript.length > maxChars) transcript = `${transcript.slice(0, maxChars - 80)} …`;
      const { content } = await requestChatCompletion({
        model,
        messages: [
          {
            role: 'user',
            content: `Summarize this earlier conversation as compact notes for yourself. Keep facts, names, numbers, decisions, and unfinished tasks. No preamble.\n\n${transcript}`,
          },
        ],
        options: { temperature: 0.2, max_tokens: 600, disable_thinking: true },
      });
      const summary = (content || '').trim();
      if (!summary) throw new Error('empty summary');
      const stamp = Number(head[0]?.createdAt) || Date.now() - 1;
      for (const m of head) await deleteMessage(m.id);
      await addMessage(convId, {
        role: 'assistant',
        content: `Compressed earlier conversation:\n${summary}`,
        modelId: model,
        createdAt: stamp,
      });
      await loadMessages();
      chatError.set('Compressed earlier turns to fit the context window.');
      return true;
    } catch (err) {
      chatError.set(err?.message ? `Could not compress: ${err.message}` : 'Could not compress earlier turns.');
      return false;
    } finally {
      compressing = false;
    }
  }

  /** True when a model is ready; otherwise sets a setup-aware chat error and returns false. */
  function ensureModelSelected() {
    if ($effectiveModelId) return true;
    const st = deriveSetupStatus();
    if (st === 'disconnected' || st === 'cloud_only') {
      chatError.set('Connect LM Studio or add a cloud API key (Settings), then click Retry in the setup guide.');
    } else if (st === 'no_models') {
      chatError.set('Load a model in LM Studio, or add an API key in Settings → API keys.');
    } else {
      chatError.set('Choose a model from the Model menu in the header.');
    }
    return false;
  }

  async function sendUserMessage(text, imageDataUrls = [], videoDataUrls = []) {
    const hasText = (text || '').trim().length > 0;
    const hasImages = imageDataUrls?.length > 0;
    const hasVideos = videoDataUrls?.length > 0;
    if (!convId || (!hasText && !hasImages && !hasVideos)) return;
    chatError.set(null);
    if (!ensureModelSelected()) return;
    if (hasImages || hasVideos) {
      let vision = listedModelCaps($effectiveModelId, $models, $modelPricingCatalog).vision;
      if (!vision && isQwen38FlashNextSelection($effectiveModelId)) {
        vision = await flashNextHasVision();
      }
      if (!vision) {
        chatError.set(`"${$effectiveModelId}" does not support image input. Switch to a vision-capable model to send images or video.`);
        return;
      }
    }

    const effectiveText = (text || '').trim();

    // Vision: skip resize for Qwen-VL 4B/8B; Flash-Next always downscales to ≤512px
    const skipResize = shouldSkipImageResizeForVision($effectiveModelId);
    const urlsForApi = hasImages
      ? (skipResize ? imageDataUrls : await resizeImageDataUrlsForVision(imageDataUrls, $effectiveModelId))
      : [];
    const userContent = hasImages
      ? [
          ...(effectiveText ? [{ type: 'text', text: effectiveText }] : [{ type: 'text', text: ' ' }]),
          ...urlsForApi.map((url) => ({
            type: 'image_url',
            image_url: { url, ...(skipResize ? {} : { detail: 'low' }) },
          })),
        ]
      : effectiveText;

    await addMessage(convId, {
      role: 'user',
      content: userContent,
      videoUrls: hasVideos ? [...videoDataUrls] : undefined,
    });
    await loadMessages();
    await streamAssistantReply();
  }

  /** Stream a new assistant reply from the conversation's current DB history. */
  async function streamAssistantReply() {
    if (!convId) return;
    const model = $effectiveModelId;
    if (model && !String(model).includes(':')) {
      const historyRaw = await getMessages(convId);
      const nCtx = await probeLocalContextSize();
      if (needsCompress(estimateMessagesTokens(historyRaw), nCtx)) {
        await compressConversation();
      }
    }
    const history = await getMessages(convId);
    let apiMessages = buildApiMessages(history, $settings.system_prompt);

    const assistantMsgId = generateId();
    const assistantPlaceholder = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      stats: null,
      modelId: $effectiveModelId,
      createdAt: Date.now(),
      imageRefs: [],
    };
    activeMessages.update((arr) => [...arr, assistantPlaceholder]);

    isStreaming.set(true);
    let fullContent = '';
    const streamImageRefs = [];
    const desktopActions = [];
    const controller = new AbortController();
    chatAbortController = controller;

    const grokModel = isGrokModel($effectiveModelId);
    const host = await fetchDesktopHostStatus(controller.signal);
    if (host.ok && convId && !grokModel) {
      const prev = desktopToolsPin.get(convId);
      desktopToolsPin.set(convId, { root: prev?.root || host.root || '' });
    }
    const pin = convId ? desktopToolsPin.get(convId) : null;
    const useDesktopTools = !!(pin && !grokModel);
    const useWebTools = !grokModel;
    const chatTools = [
      ...(useWebTools ? WEB_SEARCH_TOOLS : []),
      ...(useDesktopTools ? DESKTOP_TOOLS : []),
    ];
    if (grokModel) {
      apiMessages = mergeSystemHint(apiMessages, GROK_WEB_SEARCH_HINT);
    } else {
      if (useWebTools) apiMessages = mergeSystemHint(apiMessages, WEB_SEARCH_HINT);
      if (useDesktopTools) apiMessages = mergeSystemHint(apiMessages, desktopSystemHint(pin.root || host.root));
      // Local llama.cpp + Qwen templates inject their own tools system block.
      if (chatTools.length && !String($effectiveModelId).includes(':')) {
        apiMessages = foldSystemIntoUserMessages(apiMessages);
      }
      if (chatTools.length) apiMessages = repairOpenAiToolTurns(apiMessages);
    }

    function patchAssistant(fields) {
      activeMessages.update((arr) => {
        const out = [...arr];
        const last = out[out.length - 1];
        if (last && last.id === assistantMsgId) out[out.length - 1] = { ...last, ...fields };
        return out;
      });
    }

    const streamOpts = {
      temperature: $settings.temperature,
      max_tokens: $settings.max_tokens,
      top_p: $settings.top_p,
      top_k: $settings.top_k,
      repeat_penalty: $settings.repeat_penalty,
      presence_penalty: $settings.presence_penalty,
      frequency_penalty: $settings.frequency_penalty,
      stop: $settings.stop?.length ? $settings.stop : undefined,
      ttl: $settings.model_ttl_seconds,
      ...pickThinkingOptions($settings),
    };

    let streamResult;
    try {
      if (!String($effectiveModelId).includes(':')) {
        const nCtx = await probeLocalContextSize();
        const fitted = fitMessagesToContext(apiMessages, {
          nCtx,
          maxTokens: Number(streamOpts.max_tokens) || 4096,
        });
        contextUsage.set({ promptTokens: fitted.tokens, contextMax: nCtx });
        if (fitted.overflow) {
          chatError.set(
            `This message is larger than the local ${nCtx}-token window. Start a new chat or shorten it.`,
          );
          activeMessages.update((arr) => arr.filter((m) => m.id !== assistantMsgId));
          return;
        }
        apiMessages = fitted.messages;
        if (fitted.dropped > 0) {
          chatError.set(
            `Dropped older turns to fit the local ${nCtx}-token window (this thread was ~${fitted.originalTokens} tokens).`,
          );
        }
      }

      for (let round = 0; round < MAX_DESKTOP_TOOL_ROUNDS; round += 1) {
        fullContent = '';
        streamResult = await streamChatCompletion({
          model: $effectiveModelId,
          messages: apiMessages,
          options: streamOpts,
          tools: chatTools.length ? chatTools : undefined,
          signal: controller.signal,
          onChunk(chunk) {
            fullContent += chunk;
            patchAssistant({ content: fullContent, modelId: $effectiveModelId, imageRefs: [...streamImageRefs], toolStatus: undefined });
          },
          onImageRef(ref) {
            if (ref?.image_id) {
              streamImageRefs.push({ image_id: ref.image_id, size: (ref && 'size' in ref ? ref.size : undefined) || 'LARGE' });
              patchAssistant({ content: fullContent, modelId: $effectiveModelId, imageRefs: [...streamImageRefs] });
            }
          },
        });

        if (streamResult?.aborted) return;

        const toolCalls = streamResult?.toolCalls;
        if (chatTools.length && toolCalls?.length) {
          patchAssistant({ toolStatus: formatToolStatus(toolCalls), content: fullContent });
          const webCalls = toolCalls.filter((c) => isWebSearchToolName(c.function?.name));
          const otherCalls = toolCalls.filter((c) => !isWebSearchToolName(c.function?.name));
          let webMsgs = [];
          if (webCalls.length) {
            webSearchInProgress.set(true);
            try {
              const web = await executeWebSearchToolCalls(webCalls);
              webMsgs = web.messages;
              if (web.actions.some((a) => a.ok)) webSearchConnected.set(true);
            } finally {
              webSearchInProgress.set(false);
            }
          }
          let otherMsgs = [];
          if (useDesktopTools && otherCalls.length) {
            const desk = await executeDesktopToolCalls(otherCalls, {
              confirmWrites: async (filePath) =>
                confirm({
                  title: 'Allow writes this session',
                  message: `ATOM wants to write files under ${host.root}. First write: ${filePath || 'a file in Documents'}. This grant lasts until you quit ATOM.`,
                  confirmLabel: 'Allow writes',
                  cancelLabel: 'Deny',
                }),
              confirmJobs: async (toolName, args) =>
                confirm({
                  title: 'Allow OpenSCAD and slice this session',
                  message: `ATOM wants to run ${toolName} (${args.output || args.stl || args.scad || args.name || 'a print job'}). This allows OpenSCAD exports and OrcaSlicer slice/upload until you quit ATOM. It will not start the printer.`,
                  confirmLabel: 'Allow slice jobs',
                  cancelLabel: 'Deny',
                }),
              confirmStart: async (printName) =>
                confirm({
                  title: 'Start print on the Ender-3?',
                  message: `This heats the bed and nozzle and starts ${printName || 'the staged gcode'}. Only confirm if you have reviewed the first-layer footprint.`,
                  confirmLabel: 'Start print',
                  cancelLabel: 'Not now',
                  danger: true,
                }),
            });
            otherMsgs = desk.messages;
            desktopActions.push(...desk.actions);
          } else if (otherCalls.length) {
            otherMsgs = otherCalls.map((c) => ({
              role: 'tool',
              tool_call_id: c.id,
              content: JSON.stringify({ ok: false, error: `Unknown tool ${c.function?.name || ''}` }),
            }));
          }
          const byId = new Map([...webMsgs, ...otherMsgs].map((m) => [m.tool_call_id, m]));
          const toolMsgs = toolCalls.map((c) => byId.get(c.id)).filter(Boolean);
          await addMessage(convId, {
            role: 'assistant',
            content: fullContent || '',
            tool_calls: toolCalls,
            modelId: $effectiveModelId,
          });
          for (const m of toolMsgs) await addMessage(convId, m);
          apiMessages = [
            ...apiMessages,
            { role: 'assistant', content: fullContent || '', tool_calls: toolCalls },
            ...toolMsgs,
          ];
          continue;
        }
        break;
      }
    } catch (err) {
      const raw = err?.message || '';
      const isLoadError =
        raw.includes('Failed to load model') ||
        raw.includes('Error loading model') ||
        raw.includes('model is not loaded') ||
        raw.includes('did not become ready');
      const friendly = isLoadError
        ? 'Could not load that local model into the llama router (VRAM or file issue). Pick another local model, or check llama-server.log. Cloud models (DeepSeek/Grok) do not need a local load.'
        : raw || 'Failed to get response. Is llama-server / your model backend running?';
      chatError.set(friendly);
      activeMessages.update((arr) => arr.filter((m) => m.id !== assistantMsgId));
      return;
    } finally {
      chatAbortController = null;
      isStreaming.set(false);
    }

    if (streamResult?.aborted) return;

    maybeReadAloudAssistantReply(fullContent, assistantMsgId, get(effectiveModelId));

    const completionTokens = streamResult?.usage?.completion_tokens ?? Math.max(1, Math.ceil(fullContent.length / 4));
    const elapsedMs = streamResult?.decodeMs || streamResult?.elapsedMs || 0;
    const tokPerSec = decodeTokPerSec({
      timings: streamResult?.timings,
      completionTokens,
      decodeMs: streamResult?.decodeMs,
      elapsedMs,
    });
    const stats =
      elapsedMs > 0
        ? {
            completion_tokens: completionTokens,
            elapsed_ms: elapsedMs,
            prompt_tokens: streamResult?.usage?.prompt_tokens ?? undefined,
            tok_per_sec: tokPerSec,
            estimated: streamResult?.usage?.completion_tokens == null,
          }
        : null;
    if (streamResult?.usage?.prompt_tokens != null) {
      contextUsage.update((u) => ({
        ...u,
        promptTokens: streamResult.usage.prompt_tokens,
      }));
    }
    await addMessage(convId, {
      role: 'assistant',
      content: fullContent,
      modelId: $effectiveModelId,
      stats,
      imageRefs: streamImageRefs.length ? streamImageRefs : undefined,
      desktopActions: desktopActions.length ? desktopActions : undefined,
    });
    await loadMessages();

    const conv = $conversations.find((c) => c.id === convId);
    if (conv && conv.title === 'New chat' && fullContent) {
      const title = fullContent.slice(0, 50).replace(/\n/g, ' ').trim() || 'Chat';
      await updateConversation(convId, { title });
      const list = await listConversations();
      const withCount = await Promise.all(list.map(async (c) => ({ ...c, messageCount: await getMessageCount(c.id) })));
      conversations.set(withCount);
    }
  }

  async function clearChat() {
    if (!convId) return;
    await clearMessages(convId);
    await loadMessages();
  }

  /**
   * Regenerate from a message: for an assistant message, drop it (and anything after) and
   * re-stream; for a trailing user message (e.g. after an error), just stream a reply.
   */
  async function regenerateFromMessage(message) {
    if (!convId || $isStreaming || !message?.id) return;
    if (!ensureModelSelected()) return;
    chatError.set(null);
    const msgs = await getMessages(convId);
    const idx = msgs.findIndex((m) => m.id === message.id);
    if (idx === -1) return;
    if (message.role === 'assistant') {
      for (const m of msgs.slice(idx)) await deleteMessage(m.id);
      await loadMessages();
    }
    await streamAssistantReply();
  }

  /** Regenerate the latest reply (command palette / chatCommand). */
  async function regenerateLast() {
    if (!convId || $isStreaming) return;
    const msgs = await getMessages(convId);
    const last = msgs[msgs.length - 1];
    if (last) await regenerateFromMessage(last);
  }

  /** Replace a user message with edited text: truncate the thread there and resend. */
  async function editAndResendMessage(message, newText) {
    if (!convId || $isStreaming || !message?.id) return;
    const text = (newText || '').trim();
    if (!text) return;
    const msgs = await getMessages(convId);
    const idx = msgs.findIndex((m) => m.id === message.id);
    if (idx === -1) return;
    for (const m of msgs.slice(idx)) await deleteMessage(m.id);
    await loadMessages();
    try {
      await sendUserMessage(text);
    } catch {
      // Send aborted (e.g. web search failed) after the thread was truncated:
      // chatError is already set; put the edited text back in the input so it isn't lost.
      insertChatPrompt.set({ text, ts: Date.now() });
    }
  }

  /** Delete a single message (with confirmation). */
  async function removeMessage(message) {
    if (!convId || !message?.id) return;
    if (!(await confirm({
      title: 'Delete message',
      message: 'Delete this message from the conversation? This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    }))) return;
    await deleteMessage(message.id);
    await loadMessages();
  }

  /** Grok image only. Separate code path; does not touch DeepSeek. */
  async function handleGrokImage(prompt) {
    if (!convId) {
      chatError.set('Start or select a conversation first.');
      return;
    }
    if (!getGrokImageKey()) {
      chatError.set('Grok API key required. Add it in Settings → Cloud APIs.');
      return;
    }
    chatError.set(null);
    imageGenerating = true;
    try {
      const data = await requestGrokImageGeneration({ prompt, n: 1, aspect_ratio: '1:1', resolution: '1k', response_format: 'url' });
      const urls = data?.data?.map((d) => d?.url).filter(Boolean) ?? [];
      if (urls.length === 0) {
        chatError.set('Image generation failed—no URLs returned. Try text mode.');
        return;
      }
      const modelId = get(effectiveModelId);
      await addMessage(convId, {
        role: 'assistant',
        content: 'Generated images for your prompt.',
        imageUrls: urls,
        modelId: modelId || 'grok:grok-imagine-image',
      });
      await loadMessages();
    } catch (err) {
      chatError.set(err?.message ?? 'Image generation failed—try text mode.');
    } finally {
      imageGenerating = false;
    }
  }

  /** DeepSeek image flow: open options modal. Uses DeepInfra (single key for image + video). */
  function openImageOptionsModal(prompt) {
    if (!convId) {
      chatError.set('Start or select a conversation first.');
      return;
    }
    if (!getDeepinfraImageKey() && !getGrokImageKey()) {
      chatError.set('Add a DeepInfra or Grok API key in Settings → Cloud APIs.');
      return;
    }
    chatError.set(null);
    imageModalPrompt = (prompt || '').trim() || '';
    imageModalOpen = true;
  }

  function closeImageModal() {
    imageModalOpen = false;
  }

  /** Generate image via DeepInfra or Grok API. */
  async function handleImageModalGenerate() {
    if (!convId || !imageModalPrompt.trim()) return;
    const engine = ENGINE_OPTIONS[imageModalEngine] ?? ENGINE_OPTIONS[0];
    const qualityOpts = STEP_OPTIONS_PER_ENGINE[imageModalEngine] ?? STEP_OPTIONS_PER_ENGINE[0];
    const quality = qualityOpts[Math.min(imageModalQuality, qualityOpts.length - 1)] ?? qualityOpts[0];
    const sizeOpts = SIZE_OPTIONS_PER_ENGINE[imageModalEngine] ?? SIZE_OPTIONS_PER_ENGINE[0];
    const size = sizeOpts[Math.min(imageModalSize, sizeOpts.length - 1)] ?? sizeOpts[0];
    const n = N_OPTIONS[imageModalN] ?? 1;
    const isGrok = engine.type === 'grok';

    if (isGrok) {
      const grokKey = getGrokImageKey();
      if (!grokKey) { chatError.set('Grok API key required. Add it in Settings → Cloud APIs.'); return; }
      closeImageModal();
      imageGenerating = true;
      chatError.set(null);
      try {
        await grokImageGenerate({ modelId: engine.model, prompt: imageModalPrompt, n, resolution: quality?.resolution ?? '1k', aspect_ratio: size?.aspect_ratio ?? '1:1', apiKey: grokKey });
      } catch (err) {
        chatError.set(err?.message ?? 'Grok image generation failed.');
      } finally {
        imageGenerating = false;
      }
      return;
    }

    const key = getDeepinfraImageKey();
    if (!key) {
      chatError.set('DeepInfra API key required. Add it in Settings → Cloud APIs.');
      return;
    }
    const modelId = engine.model;
    closeImageModal();
    imageGenerating = true;
    chatError.set(null);
    try {
      const data = await requestDeepInfraImageGeneration({
        apiKey: key,
        modelId,
        prompt: imageModalPrompt,
        num_images: n,
        num_inference_steps: quality?.steps ?? 4,
        guidance_scale: 7.5,
        width: size.width ?? 1024,
        height: size.height ?? 1024,
      });
      const urls = data?.data?.map((d) => d?.url).filter(Boolean) ?? [];
      if (urls.length === 0) {
        chatError.set('Image generation failed—no images returned.');
        return;
      }
      const modelIdEffective = get(effectiveModelId);
      const imageUrlsToStore = [...urls];
      await addMessage(convId, {
        role: 'assistant',
        content: 'Generated images for your prompt.',
        imageUrls: imageUrlsToStore,
        modelId: modelIdEffective || 'deepseek:deepseek-chat',
      });
      await loadMessages();
    } catch (err) {
      chatError.set(err?.message ?? 'Image generation failed.');
    } finally {
      imageGenerating = false;
    }
  }

  /** Grok image generation (called from modal for Grok engines, or direct from image button). */
  async function grokImageGenerate({ modelId, prompt, n, resolution, aspect_ratio, apiKey }) {
    const data = await requestGrokImageGeneration({ prompt, n, resolution, aspect_ratio, response_format: 'url', apiKey, modelId });
    const urls = data?.data?.map((d) => d?.url).filter(Boolean) ?? [];
    if (urls.length === 0) {
      chatError.set('Image generation failed—no URLs returned.');
      return;
    }
    const modelIdEffective = get(effectiveModelId);
    await addMessage(convId, {
      role: 'assistant',
      content: 'Generated images for your prompt.',
      imageUrls: urls,
      modelId: modelIdEffective || `grok:${modelId}`,
    });
    await loadMessages();
  }

  /** Video: open modal (prompt + model). */
  function openVideoModal(prompt) {
    if (!convId) {
      chatError.set('Start or select a conversation first.');
      return;
    }
    const key = getDeepinfraImageKey();
    if (!key) {
      chatError.set('DeepInfra API key required. Add it in Settings → Cloud APIs.');
      return;
    }
    chatError.set(null);
    videoModalPrompt = (prompt || '').trim() || '';
    videoModalOpen = true;
  }

  function closeVideoModal() {
    videoModalOpen = false;
  }

  /** Generate video via DeepInfra (synchronous; response.video_url or response.videos → full URL). */
  async function handleVideoModalGenerate() {
    if (!convId || !videoModalPrompt.trim()) return;
    const key = getDeepinfraImageKey();
    if (!key) {
      chatError.set('DeepInfra API key required.');
      return;
    }
    const engine = VIDEO_ENGINE_OPTIONS[videoModalEngine];
    const modelId = engine?.modelId ?? VIDEO_ENGINE_OPTIONS[0].modelId;
    closeVideoModal();
    videoGenerating = true;
    chatError.set(null);
    try {
      // DeepInfra video: ONLY prompt. Do not pass width, height, duration, negative_prompt, or any other field.
      const data = await requestDeepInfraVideoGeneration({
        apiKey: key,
        modelId,
        prompt: videoModalPrompt,
      });
      const videoUrl = data?.videoUrl;
      if (!videoUrl) {
        chatError.set('Video generation failed—no video URL returned.');
        return;
      }
      const elapsedSec = Math.round((Date.now() - videoGenStartMs) / 1000);
      const elapsedMin = Math.floor(elapsedSec / 60);
      const elapsedRemSec = elapsedSec % 60;
      const elapsedStr = elapsedMin > 0
        ? `${elapsedMin}m ${elapsedRemSec}s`
        : `${elapsedSec}s`;
      const modelIdEffective = get(effectiveModelId);
      await addMessage(convId, {
        role: 'assistant',
        content: `Generated video (${elapsedStr}).`,
        videoUrls: [String(videoUrl)],
        modelId: modelIdEffective || 'deepseek:deepseek-chat',
      });
      await loadMessages();
    } catch (err) {
      chatError.set(err?.message ?? 'Video generation failed.');
    } finally {
      videoGenerating = false;
    }
  }
</script>

<div
  class="flex-1 flex flex-col min-h-0 chat-drop-zone"
  role="application"
  ondragover={(e) => { e.preventDefault(); e.stopPropagation(); }}
  ondrop={(e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (files?.length) pendingDroppedFiles.set(files);
  }}
>
  <!-- Image options modal (DeepSeek/Together flow): engine, quality, size, n → Generate -->
  {#if imageModalOpen}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      style="background: rgba(0,0,0,0.5);"
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-modal-title"
    >
      <div class="w-full max-w-md rounded-xl shadow-xl p-5 flex flex-col gap-4" style="background: var(--ui-bg-main); border: 1px solid var(--ui-border);">
        <h2 id="image-modal-title" class="text-lg font-semibold" style="color: var(--ui-text-primary);">Generate image</h2>
        <div>
          <label for="image-modal-prompt" class="block text-sm font-medium mb-1" style="color: var(--ui-text-secondary);">Prompt</label>
          <textarea
            id="image-modal-prompt"
            bind:value={imageModalPrompt}
            rows="3"
            class="w-full rounded border px-3 py-2 text-sm resize-none"
            style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
            placeholder="Describe the image you want"
          ></textarea>
        </div>
        <div>
          <label for="image-modal-engine" class="block text-sm font-medium mb-1" style="color: var(--ui-text-secondary);">Choose Image Engine</label>
          <select
            id="image-modal-engine"
            bind:value={imageModalEngine}
            class="w-full rounded border px-3 py-2 text-sm"
            style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
          >
            {#each ENGINE_OPTIONS as opt, i (opt.model)}
              <option value={i}>{opt.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="image-modal-quality" class="block text-sm font-medium mb-1" style="color: var(--ui-text-secondary);">Quality / Steps</label>
          <select
            id="image-modal-quality"
            bind:value={imageModalQuality}
            class="w-full rounded border px-3 py-2 text-sm"
            style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
          >
            {#each imageModalQualityOptions as opt, i}
              <option value={i}>{opt.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="image-modal-size" class="block text-sm font-medium mb-1" style="color: var(--ui-text-secondary);">Size</label>
          <select
            id="image-modal-size"
            bind:value={imageModalSize}
            class="w-full rounded border px-3 py-2 text-sm"
            style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
          >
            {#each imageModalSizeOptions as opt, i}
              <option value={i}>{opt.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="image-modal-n" class="block text-sm font-medium mb-1" style="color: var(--ui-text-secondary);">Number of images</label>
          <select
            id="image-modal-n"
            bind:value={imageModalN}
            class="w-full rounded border px-3 py-2 text-sm"
            style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
          >
            {#each N_OPTIONS as num, i}
              <option value={i}>{num}</option>
            {/each}
          </select>
        </div>
        <div class="flex gap-2 justify-end pt-2">
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm font-medium"
            style="background: var(--ui-input-bg); border: 1px solid var(--ui-border); color: var(--ui-text-primary);"
            onclick={closeImageModal}
          >Cancel</button>
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm font-medium"
            style="background: var(--ui-action, var(--ui-accent)); color: var(--ui-action-ink, var(--ui-bg-main));"
            onclick={handleImageModalGenerate}
            disabled={imageGenerating || !canGenerateImage}
          >{imageGenerating ? 'Generating…' : 'Generate'}</button>
        </div>
      </div>
    </div>
  {/if}
  <!-- Video options modal (DeepInfra): prompt + model → Generate -->
  {#if videoModalOpen}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      style="background: rgba(0,0,0,0.5);"
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-modal-title"
    >
      <div class="w-full max-w-md rounded-xl shadow-xl p-5 flex flex-col gap-4" style="background: var(--ui-bg-main); border: 1px solid var(--ui-border);">
        <h2 id="video-modal-title" class="text-lg font-semibold" style="color: var(--ui-text-primary);">Generate video</h2>
        <div>
          <label for="video-modal-prompt" class="block text-sm font-medium mb-1" style="color: var(--ui-text-secondary);">Prompt</label>
          <textarea
            id="video-modal-prompt"
            bind:value={videoModalPrompt}
            rows="3"
            class="w-full rounded border px-3 py-2 text-sm resize-none"
            style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
            placeholder="Describe the video you want"
          ></textarea>
        </div>
        <div>
          <label for="video-modal-engine" class="block text-sm font-medium mb-1" style="color: var(--ui-text-secondary);">Model</label>
          <select
            id="video-modal-engine"
            bind:value={videoModalEngine}
            class="w-full rounded border px-3 py-2 text-sm"
            style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
          >
            {#each VIDEO_ENGINE_OPTIONS as opt, i (opt.modelId)}
              <option value={i}>{opt.label}</option>
            {/each}
          </select>
        </div>
        <p class="text-xs" style="color: var(--ui-text-secondary);">Video can take 5–10+ minutes. Please wait—do not close the tab.</p>
        <div class="flex gap-2 justify-end pt-2">
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm font-medium"
            style="background: var(--ui-input-bg); border: 1px solid var(--ui-border); color: var(--ui-text-primary);"
            onclick={closeVideoModal}
          >Cancel</button>
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm font-medium"
            style="background: var(--ui-action, var(--ui-accent)); color: var(--ui-action-ink, var(--ui-bg-main));"
            onclick={handleVideoModalGenerate}
            disabled={videoGenerating || !videoModalPrompt.trim()}
          >{videoGenerating ? 'Generating…' : 'Generate'}</button>
        </div>
      </div>
    </div>
  {/if}
  {#if convId}
    {#if $activeMessages.length === 0}
      <!-- Greeting: one clear headline + single input bar -->
      <div class="ui-splash-wrap flex-1 flex flex-col items-center justify-center px-4 py-6 min-h-0">
        <div class="w-full max-w-[min(48rem,92%)] mx-auto flex flex-col items-center gap-5">

          <div class="flex flex-col items-center gap-4">
            <div class="atom-brand-mark" style="width: 4.25rem; height: 4.25rem;">
              <AtomLogo size={42} />
            </div>
            <p class="ui-greeting-kicker">Local intelligence</p>
            <h1 class="ui-greeting-title text-5xl md:text-6xl text-center" style="color: var(--ui-text-primary);">ATOM</h1>
            <p class="ui-greeting-welcome text-base text-center max-w-md" style="color: var(--ui-text-secondary);">Your models. Your keys. A room that doesn’t look like every other chat app.</p>
            {#if welcomeLine}
              <p class="ui-greeting-welcome text-sm text-center animate-fade-in" style="color: var(--ui-accent); opacity: 0.9;">{welcomeLine}</p>
            {/if}
            <p class="text-[11px] text-center max-w-md" style="color: var(--ui-text-secondary);">This chat can list, read, and (after one approval) write files in your Documents folder.</p>
          </div>
          <SetupGuide />
          <div class="w-full flex flex-wrap justify-center gap-2" role="list" aria-label="Example prompts">
            {#each STARTER_PROMPTS as prompt}
              <button
                type="button"
                role="listitem"
                class="starter-chip px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style="border: 1px solid var(--ui-border); color: var(--ui-text-secondary); background: var(--ui-bg-sidebar);"
                onclick={() => useStarterPrompt(prompt)}
              >
                {prompt}
              </button>
            {/each}
          </div>
          {#if $chatError}
            <div class="chat-error-banner w-full px-4 py-2.5 rounded-lg text-sm flex items-center justify-between gap-2" role="alert" style="background: color-mix(in srgb, var(--ui-accent-hot, #dc2626) 10%, transparent); color: var(--ui-text-primary);">
              <span>{$chatError}</span>
              <button type="button" class="shrink-0 p-1 rounded transition-opacity hover:opacity-80" style="color: var(--ui-text-secondary);" onclick={() => chatError.set(null)} aria-label="Dismiss">×</button>
            </div>
          {/if}
          <div class="w-full min-w-0">
            <ChatInput
              onSend={sendUserMessage}
              onStop={() => chatAbortController?.abort?.()}
              onGenerateImageGrok={undefined}
              onGenerateImageDeepSeek={canOfferImage ? openImageOptionsModal : undefined}
              onGenerateVideoDeepSeek={canOfferVideo ? openVideoModal : undefined}
              imageGenerating={imageGenerating}
              videoGenerating={videoGenerating}
              videoGenElapsed={videoGenElapsed}
              placeholder="Ask anything…"
            />
          </div>
        </div>
      </div>
    {:else}
      <!-- After first message: messages above, input fixed at bottom -->
      <div class="chat-messages-scroll flex-1 overflow-y-auto min-h-0">
        <MessageList onRegenerate={regenerateFromMessage} onEditResend={editAndResendMessage} onDelete={removeMessage} />
      </div>
      <div class="chat-input-dock shrink-0 px-2 py-2 sm:p-4">
        <div class="max-w-[min(52rem,92%)] mx-auto w-full">
          {#if $chatError}
            <div class="chat-error-banner mb-3 px-4 py-3 rounded-xl text-sm flex items-center justify-between gap-2" role="alert" style="background: color-mix(in srgb, var(--ui-accent-hot, #dc2626) 10%, transparent); color: var(--ui-text-primary);">
              <span>{$chatError}</span>
              <button type="button" class="shrink-0 p-1.5 rounded-lg transition-opacity hover:opacity-80" style="color: var(--ui-text-secondary);" onclick={() => chatError.set(null)} aria-label="Dismiss">×</button>
            </div>
          {/if}
          <ChatInput
            onSend={sendUserMessage}
            onStop={() => chatAbortController?.abort?.()}
            onGenerateImageGrok={$effectiveModelId && isGrokModel($effectiveModelId) && grokKeyPresent ? handleGrokImage : undefined}
            onGenerateImageDeepSeek={canOfferImage ? openImageOptionsModal : undefined}
            onGenerateVideoDeepSeek={canOfferVideo ? openVideoModal : undefined}
            imageGenerating={imageGenerating}
            videoGenerating={videoGenerating}
            videoGenElapsed={videoGenElapsed}
          />
        </div>
      </div>
    {/if}
  {:else}
    <div class="flex-1 flex items-center justify-center p-8">
      <div class="text-center max-w-sm">
        <p class="text-xl font-semibold" style="color: var(--ui-text-primary);">Start a conversation</p>
        <p class="text-sm mt-2" style="color: var(--ui-text-secondary);">Create a new chat from the sidebar or select an existing one.</p>
      </div>
    </div>
  {/if}
</div>
