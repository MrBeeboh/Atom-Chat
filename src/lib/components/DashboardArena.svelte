<script>
  /**
   * DashboardArena (ATOM Arena): head-to-head model comparison with optional judge scoring.
   * Layout: header (model cards A–D) → question bar (Q selector, Ask, Next, Web globe, Judgment, Reset, Settings) → response panels (resizable) → footer (ChatInput).
   * Bottom-left floating panel: full question text (no truncation) + "Ask the Judge" interactive side-conversation.
   * Right slide-out: Arena settings (Questions, Answer key, Contest rules, Execution, Web search, Actions).
   * Judge: slot A can be "Use as judge" (checkbox in panel A header); Judgment button runs A to score B/C/D and updates arenaScores.
   */
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { chatError, dashboardModelA, dashboardModelB, dashboardModelC, dashboardModelD, isStreaming, settings, globalDefault, perModelOverrides, getEffectiveSettingsForModel, mergeEffectiveSettings, liveTokens, pushTokSample, liveTokPerSec, arenaPanelCount, arenaSlotAIsJudge, arenaWebSearchMode, arenaSlotOverrides, setArenaSlotOverride, pendingDroppedFiles, webSearchForNextMessage, webSearchInProgress, webSearchConnected, layout, lmStudioUnloadHelperUrl, confirm } from '$lib/stores.js';
  import { playClick, playComplete } from '$lib/audio.js';
  import { streamChatCompletion, unloadModel, loadModel, waitUntilUnloaded, unloadAllLoadedModels } from '$lib/api.js';
  import { searchDuckDuckGo, formatSearchResultForChat, warmUpSearchConnection } from '$lib/duckduckgo.js';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import ThinkingAtom from '$lib/components/ThinkingAtom.svelte';
  import ModelSelectorSlot from '$lib/components/ModelSelectorSlot.svelte';
  import ArenaPanel from '$lib/components/ArenaPanel.svelte';
  import ArenaScoreMatrix from '$lib/components/ArenaScoreMatrix.svelte';
  import { generateId, resizeImageDataUrlsForVision, shouldSkipImageResizeForVision } from '$lib/utils.js';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import {
    parseQuestionsAndAnswers, parseJudgeScores, stripThinkBlocks, detectLoop, contentToText,
    ARENA_SYSTEM_PROMPT_TEMPLATES, JUDGE_WEB_LINES, arenaStandingLabel, buildJudgePrompt,
    loadScoreHistory, saveScoreHistory, addScoreRound, computeTotals, clearScoreHistory,
    migrateOldQuestionsAndAnswers,
  } from '$lib/arenaLogic.js';

  // ---------- State ----------
  let messagesA = $state([]);
  let messagesB = $state([]);
  let messagesC = $state([]);
  let messagesD = $state([]);
  let running = $state({ A: false, B: false, C: false, D: false });
  let slotErrors = $state({ A: '', B: '', C: '', D: '' });
  let sequential = $state(
    typeof localStorage !== 'undefined'
      ? (localStorage.getItem('arenaSequential') ?? '1') !== '0'
      : true
  );
  /** Optional feedback/correction sent to the judge (e.g. correct NFPA 72 definition). */
  let judgeFeedback = $state('');
  /** Arena footer: Questions list expanded vs collapsed. */
  let arenaSetupExpanded = $state(
    typeof localStorage !== 'undefined' ? (localStorage.getItem('arenaSetupExpanded') ?? '1') !== '0' : true
  );
  $effect(() => {
    if (typeof localStorage !== 'undefined' && arenaSetupExpanded !== undefined)
      localStorage.setItem('arenaSetupExpanded', arenaSetupExpanded ? '1' : '0');
  });
  /** Contest rules: persistent, sent with each question. Stored in localStorage. */
  let contestRules = $state(
    typeof localStorage !== 'undefined' ? (localStorage.getItem('arenaContestRules') ?? '') : ''
  );
  $effect(() => {
    if (typeof localStorage !== 'undefined' && contestRules !== undefined)
      localStorage.setItem('arenaContestRules', contestRules);
  });
  /**
   * Single "Questions & answers" block. Format:
   *   1. Question text here
   *   Answer: Optional answer for the judge (if omitted, judge uses web or own knowledge).
   *   2. Next question
   *   Answer: Next answer
   * Persisted. Parsed into questions[] and answers[] (per-question; answers[i] may be '').
   */
  function loadQuestionsAndAnswers() {
    if (typeof localStorage === 'undefined') return '';
    const next = localStorage.getItem('arenaQuestionsAndAnswers');
    if (next != null && next !== '') return next;
    const oldQ = localStorage.getItem('arenaQuestionsList') ?? '';
    const oldA = localStorage.getItem('arenaAnswerKey') ?? '';
    if (oldQ.trim() === '' && oldA.trim() === '') return '';
    if (oldQ.trim() === '') return '';
    return migrateOldQuestionsAndAnswers(oldQ, oldA);
  }
  let questionsAndAnswers = $state(loadQuestionsAndAnswers());
  let questionIndex = $state(0);
  $effect(() => {
    if (typeof localStorage !== 'undefined' && questionsAndAnswers !== undefined)
      localStorage.setItem('arenaQuestionsAndAnswers', questionsAndAnswers);
  });

  const { questions: parsedQuestions, answers: parsedAnswers } = $derived(parseQuestionsAndAnswers(questionsAndAnswers));
  /** Answer for the current question only (blank if none provided → judge uses web or own knowledge). */
  const currentQuestionAnswer = $derived(
    parsedQuestions.length > 0 && parsedAnswers.length > 0
      ? (parsedAnswers[questionIndex % parsedQuestions.length] || '').trim()
      : ''
  );
  const currentQuestionNum = $derived(parsedQuestions.length > 0 ? (questionIndex % parsedQuestions.length) + 1 : 0);
  const currentQuestionTotal = $derived(parsedQuestions.length);
  const currentQuestionText = $derived(
    parsedQuestions.length > 0 ? (parsedQuestions[questionIndex % parsedQuestions.length] || '').trim() : ''
  );
  /** Arena settings panel (slide-out from right). */
  let arenaSettingsOpen = $state(false);
  // ---------- Web globe (same behavior as cockpit ChatInput globe) ----------
  let arenaWebWarmingUp = $state(false);
  let arenaWebWarmUpAttempted = $state(false);
  function runArenaWarmUp() {
    arenaWebWarmUpAttempted = true;
    arenaWebWarmingUp = true;
    webSearchConnected.set(false);
    warmUpSearchConnection().then((ok) => {
      arenaWebWarmingUp = false;
      webSearchConnected.set(ok);
    });
  }
  /** Auto-start warm-up when web search is turned on (uses $store for Svelte 5 reactivity). */
  $effect(() => {
    const on = $webSearchForNextMessage;
    const connected = $webSearchConnected;
    if (!on) { arenaWebWarmUpAttempted = false; return; }
    if (connected || arenaWebWarmingUp || arenaWebWarmUpAttempted) return;
    runArenaWarmUp();
  });

  /** Accordion open state in settings panel. */
  let settingsRulesExpanded = $state(false);
  /** Ask the Judge: collapsible panel bottom-left; default collapsed. */
  let askJudgeExpanded = $state(false);
  let askJudgeQuestion = $state('');
  let askJudgeReply = $state('');
  let askJudgeLoading = $state(false);
  let runId = 0;
  let lastSampleAt = 0;
  let lastSampleTokens = 0;
  /** Which Arena slot's "Model options" panel is open: 'A'|'B'|'C'|'D'|null */
  let optionsOpenSlot = $state(null);
  /** Sequential/judge transition: show 'ejecting' | 'loading' | 'judge_web' with atom animation. */
  let arenaTransitionPhase = $state(/** @type {null | 'ejecting' | 'loading' | 'judge_web'} */ (null));
  /** Index of the current witty "judge checking web" message (rotated each time we enter judge_web). */
  let judgeWebMessageIndex = $state(0);
  // JUDGE_WEB_LINES imported from arenaLogic.js

  // ---------- Score history (per-question breakdown) ----------
  let scoreHistory = $state(loadScoreHistory());
  const scoreTotals = $derived(computeTotals(scoreHistory));

  // ---------- Judge instructions (custom rubric) ----------
  let judgeInstructions = $state(
    typeof localStorage !== 'undefined' ? (localStorage.getItem('arenaJudgeInstructions') ?? '') : ''
  );
  $effect(() => {
    if (typeof localStorage !== 'undefined' && judgeInstructions !== undefined)
      localStorage.setItem('arenaJudgeInstructions', judgeInstructions);
  });

  // ---------- Run All automation ----------
  let runAllActive = $state(false);
  let runAllProgress = $state({ current: 0, total: 0 });

  // ---------- Arena message persistence (survive refresh) ----------
  function saveArenaMessages() {
    if (typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.setItem('arenaMessagesA', JSON.stringify(messagesA));
      sessionStorage.setItem('arenaMessagesB', JSON.stringify(messagesB));
      sessionStorage.setItem('arenaMessagesC', JSON.stringify(messagesC));
      sessionStorage.setItem('arenaMessagesD', JSON.stringify(messagesD));
    } catch (_) { /* sessionStorage full or unavailable */ }
  }
  function loadArenaMessages() {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const a = sessionStorage.getItem('arenaMessagesA');
      const b = sessionStorage.getItem('arenaMessagesB');
      const c = sessionStorage.getItem('arenaMessagesC');
      const d = sessionStorage.getItem('arenaMessagesD');
      if (a) messagesA = JSON.parse(a);
      if (b) messagesB = JSON.parse(b);
      if (c) messagesC = JSON.parse(c);
      if (d) messagesD = JSON.parse(d);
    } catch (_) {}
  }
  // Load persisted messages on mount
  onMount(() => { loadArenaMessages(); });
  // Save whenever messages change
  $effect(() => { messagesA; messagesB; messagesC; messagesD; saveArenaMessages(); });

  const _REMOVED_JUDGE_WEB_LINES = [ // eslint-disable-line no-unused-vars -- imported from arenaLogic.js now; kept to avoid git churn on smart-quoted strings
    { main: 'Judge is checking the web…', sub: '(Googling so the judge can fact-check. No, really.)' },
    { main: 'Judge is checking the internet.', sub: '(Yes, the whole thing. We asked nicely.)' },
    { main: 'Judge is consulting the oracle.', sub: '(It’s Google. But “oracle” sounds cooler.)' },
    { main: 'Judge is fact-checking in the cloud.', sub: '(Someone had to. It’s not gonna check itself.)' },
    { main: 'Judge is asking the internet.', sub: '(We’ll see if it answers. Usually it’s cats.)' },
    { main: 'Judge is doing the research.', sub: '(So you don’t have to. You’re welcome.)' },
    { main: 'Judge is verifying things.', sub: '(Rumors say the internet has facts. We’re testing that.)' },
    { main: 'Judge is hitting the books.', sub: '(The books are web servers. Same energy.)' },
    { main: 'Judge is checking the web…', sub: '(Making sure the models didn’t just make it up. Again.)' },
  ];

  // ---------- Draggable floating panels (question + Ask the Judge) ----------
  function loadPanelPos(key, defaultX, defaultY) {
    if (typeof localStorage === 'undefined') return { x: defaultX, y: defaultY };
    try {
      const s = localStorage.getItem(key);
      if (!s) return { x: defaultX, y: defaultY };
      const { x, y } = JSON.parse(s);
      if (typeof x === 'number' && typeof y === 'number') return { x, y };
    } catch (_) {}
    return { x: defaultX, y: defaultY };
  }
  // questionPanelPos removed — floating question panel no longer needed
  let askJudgePanelPos = $state(loadPanelPos('arenaAskJudgePanelPos', 16, 300));

  function loadPanelSize(key, defaultW, defaultH) {
    if (typeof localStorage === 'undefined') return { w: defaultW, h: defaultH };
    try {
      const s = localStorage.getItem(key);
      if (!s) return { w: defaultW, h: defaultH };
      const { w, h } = JSON.parse(s);
      if (typeof w === 'number' && typeof h === 'number') return { w, h };
    } catch (_) {}
    return { w: defaultW, h: defaultH };
  }
  // questionPanelSize / QUESTION_PANEL_MIN removed — floating question panel no longer needed

  /**
   * Svelte action: make the panel draggable by its handle. Handle must be a direct child of the panel.
   * Updates getPos/setPos and persists to localStorage on drag end; clamps to viewport.
   */
  function makeDraggable(handleEl, params) {
    if (!params || !handleEl) return;
    const { storageKey, getPos, setPos } = params;
    const panelEl = handleEl.parentElement;
    if (!panelEl) return;

    let dragging = false;
    function move(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      setPos({ x: startLeft + dx, y: startTop + dy });
    }
    function up() {
      dragging = false;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      const pos = getPos();
      const rect = panelEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.max(0, Math.min(vw - rect.width, pos.x));
      const y = Math.max(0, Math.min(vh - rect.height, pos.y));
      setPos({ x, y });
      if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, JSON.stringify({ x, y }));
    }
    let startX, startY, startLeft, startTop;
    function down(e) {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      const p = getPos();
      startLeft = p.x;
      startTop = p.y;
      dragging = true;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }
    handleEl.addEventListener('pointerdown', down);
    return {
      destroy() {
        handleEl.removeEventListener('pointerdown', down);
        // Always clean up document listeners on destroy (prevents leaks if destroyed mid-drag)
        if (dragging) {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
        }
      },
    };
  }

  /**
   * Svelte action: resize panel by dragging. Handle is on edge or corner.
   * axis: 'e' = right edge (width), 's' = bottom edge (height), 'se' = corner (both).
   */
  function makeResizable(handleEl, params) {
    if (!params || !handleEl) return;
    const { storageKey, getSize, setSize, axis } = params;
    const panelEl = handleEl.closest('.arena-floating-panel');
    if (!panelEl) return;

    let resizingActive = false;
    function move(e) {
      let { w, h } = getSize();
      if (axis === 'e' || axis === 'se') {
        w = Math.max(QUESTION_PANEL_MIN_W, startW + (e.clientX - startX));
        w = Math.min(window.innerWidth - (panelEl.getBoundingClientRect().left || 0), w);
      }
      if (axis === 's' || axis === 'se') {
        h = Math.max(QUESTION_PANEL_MIN_H, startH + (e.clientY - startY));
        h = Math.min(window.innerHeight - (panelEl.getBoundingClientRect().top || 0), h);
      }
      setSize({ w, h });
    }
    function up() {
      resizingActive = false;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (typeof localStorage !== 'undefined' && storageKey) {
        const size = getSize();
        localStorage.setItem(storageKey, JSON.stringify({ w: size.w, h: size.h }));
      }
    }
    let startX, startY, startW, startH;
    function down(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      const sz = getSize();
      startW = sz.w;
      startH = sz.h;
      resizingActive = true;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }
    handleEl.addEventListener('pointerdown', down);
    return {
      destroy() {
        handleEl.removeEventListener('pointerdown', down);
        // Always clean up document listeners on destroy (prevents leaks if destroyed mid-resize)
        if (resizingActive) {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
        }
      },
    };
  }

  /** Eject-all in progress; message after (success or error). */
  let ejectBusy = $state(false);
  let ejectMessage = $state(/** @type {null | string} */ (null));

  /** Running scores from judge (B, C, D). Persisted to localStorage. */
  const loadArenaScores = () => {
    if (typeof localStorage === 'undefined') return { B: 0, C: 0, D: 0 };
    try {
      const raw = localStorage.getItem('arenaScores');
      if (!raw) return { B: 0, C: 0, D: 0 };
      const o = JSON.parse(raw);
      return { B: Number(o.B) || 0, C: Number(o.C) || 0, D: Number(o.D) || 0 };
    } catch {
      return { B: 0, C: 0, D: 0 };
    }
  };
  let arenaScores = $state(loadArenaScores());
  $effect(() => {
    if (typeof localStorage !== 'undefined' && arenaScores)
      localStorage.setItem('arenaScores', JSON.stringify(arenaScores));
  });

  // ---------- Abort controllers (per-slot stream cancel) ----------
  const aborters = { A: null, B: null, C: null, D: null };

  const effectiveForA = $derived(mergeEffectiveSettings($dashboardModelA || '', $globalDefault, $perModelOverrides));
  const effectiveForB = $derived(mergeEffectiveSettings($dashboardModelB || '', $globalDefault, $perModelOverrides));
  const effectiveForC = $derived(mergeEffectiveSettings($dashboardModelC || '', $globalDefault, $perModelOverrides));
  const effectiveForD = $derived(mergeEffectiveSettings($dashboardModelD || '', $globalDefault, $perModelOverrides));

  // ---------- Lifecycle ----------
  onMount(() => {
    function onKeydown(e) {
      if (get(layout) !== 'arena') return;
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = e.key === '1' ? 1 : e.key === '2' ? 2 : e.key === '3' ? 3 : e.key === '4' ? 4 : null;
      if (n != null) {
        e.preventDefault();
        arenaPanelCount.set(n);
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });

  // ---------- Judge / scores ----------
  // parseJudgeScores, arenaStandingLabel imported from arenaLogic.js

  function resetArenaScores() {
    arenaScores = { B: 0, C: 0, D: 0 };
    scoreHistory = [];
    clearScoreHistory();
  }

  /** Full arena reset: clear all messages, scores, history, errors, go back to Q1. */
  async function startOver() {
    const ok = await confirm({
      title: 'Start over',
      message: 'Clear all model responses, reset all scores, and go back to question 1. This cannot be undone.',
      confirmLabel: 'Start over',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    // Stop any running streams
    stopAll();
    // Clear all slot messages
    messagesA = [];
    messagesB = [];
    messagesC = [];
    messagesD = [];
    // Reset scores and history
    arenaScores = { B: 0, C: 0, D: 0 };
    scoreHistory = [];
    clearScoreHistory();
    // Reset to Q1
    questionIndex = 0;
    // Clear errors
    chatError.set(null);
    slotErrors = { A: '', B: '', C: '', D: '' };
    // Clear persisted messages
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('arenaMessagesA');
      sessionStorage.removeItem('arenaMessagesB');
      sessionStorage.removeItem('arenaMessagesC');
      sessionStorage.removeItem('arenaMessagesD');
    }
    // Clear ask the judge state
    askJudgeReply = '';
    askJudgeQuestion = '';
    // Clear Run All state
    runAllActive = false;
    runAllProgress = { current: 0, total: 0 };
  }

  // ---------- Per-slot overrides & system prompt templates ----------
  // ARENA_SYSTEM_PROMPT_TEMPLATES imported from arenaLogic.js
  function applySystemPromptTemplate(slot, templatePrompt) {
    if (!templatePrompt) return;
    setArenaSlotOverride(slot, { ...($arenaSlotOverrides[slot] ?? {}), system_prompt: templatePrompt });
  }
  /** Helper for per-slot override inputs so we get correct event target type. Defensive against NaN/invalid. */
  function slotOverrideInput(slot, key) {
    return (e) => {
      const el = e.currentTarget;
      if (!el || typeof el.value === 'undefined') return;
      const raw = el.value;
      const cur = $arenaSlotOverrides[slot] ?? {};
      if (key === 'temperature') {
        const v = raw === '' ? undefined : parseFloat(raw);
        const safe = v !== undefined && !Number.isNaN(v) && v >= 0 && v <= 2 ? v : cur.temperature;
        setArenaSlotOverride(slot, { ...cur, temperature: safe });
      } else if (key === 'max_tokens') {
        const v = raw === '' ? undefined : parseInt(raw, 10);
        const safe = v !== undefined && !Number.isNaN(v) && v >= 1 ? Math.min(100000, v) : cur.max_tokens;
        setArenaSlotOverride(slot, { ...cur, max_tokens: safe });
      } else if (key === 'system_prompt') {
        setArenaSlotOverride(slot, { ...cur, system_prompt: typeof raw === 'string' ? raw.trim() || undefined : undefined });
      } else if (key === 'top_p') {
        const v = raw === '' ? undefined : parseFloat(raw);
        const safe = v !== undefined && !Number.isNaN(v) && v >= 0 && v <= 1 ? v : cur.top_p;
        setArenaSlotOverride(slot, { ...cur, top_p: safe });
      } else if (key === 'top_k') {
        const v = raw === '' ? undefined : parseInt(raw, 10);
        const safe = v !== undefined && !Number.isNaN(v) && v >= 1 ? Math.min(200, v) : cur.top_k;
        setArenaSlotOverride(slot, { ...cur, top_k: safe });
      } else if (key === 'repeat_penalty') {
        const v = raw === '' ? undefined : parseFloat(raw);
        const safe = v !== undefined && !Number.isNaN(v) && v >= 1 && v <= 2 ? v : cur.repeat_penalty;
        setArenaSlotOverride(slot, { ...cur, repeat_penalty: safe });
      } else if (key === 'presence_penalty') {
        const v = raw === '' ? undefined : parseFloat(raw);
        const safe = v !== undefined && !Number.isNaN(v) && v >= -2 && v <= 2 ? v : cur.presence_penalty;
        setArenaSlotOverride(slot, { ...cur, presence_penalty: safe });
      } else if (key === 'frequency_penalty') {
        const v = raw === '' ? undefined : parseFloat(raw);
        const safe = v !== undefined && !Number.isNaN(v) && v >= -2 && v <= 2 ? v : cur.frequency_penalty;
        setArenaSlotOverride(slot, { ...cur, frequency_penalty: safe });
      }
    };
  }

  // ---------- Message helpers (get/set/push/update per slot) ----------
  function getMessages(slot) {
    return slot === 'A' ? messagesA : slot === 'B' ? messagesB : slot === 'C' ? messagesC : messagesD;
  }
  function setMessages(slot, next) {
    if (slot === 'A') messagesA = next;
    else if (slot === 'B') messagesB = next;
    else if (slot === 'C') messagesC = next;
    else messagesD = next;
  }
  function pushMessage(slot, msg) {
    setMessages(slot, [...getMessages(slot), msg]);
  }
  function updateMessage(slot, id, nextProps) {
    const msgs = getMessages(slot);
    const idx = msgs.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const next = [...msgs];
    next[idx] = { ...next[idx], ...nextProps };
    setMessages(slot, next);
  }
  function setRunning(slot, value) {
    running = { ...running, [slot]: value };
  }
  function setSlotError(slot, message) {
    slotErrors = { ...slotErrors, [slot]: message || '' };
  }

  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('arenaSequential', sequential ? '1' : '0');
    }
  });

  // detectLoop imported from arenaLogic.js

  /** Effective settings for one Arena slot: per-model effective + per-slot session overrides. */
  function getSettingsForSlot(slot) {
    const modelId = slot === 'A' ? $dashboardModelA : slot === 'B' ? $dashboardModelB : slot === 'C' ? $dashboardModelC : $dashboardModelD;
    const base = getEffectiveSettingsForModel(modelId || '');
    const over = $arenaSlotOverrides[slot];
    if (!over || Object.keys(over).length === 0) return base;
    return {
      ...base,
      ...over,
      system_prompt: over.system_prompt !== undefined && over.system_prompt !== '' ? over.system_prompt : base.system_prompt,
    };
  }

  function buildApiMessages(msgs, systemPromptOverride) {
    const apiMessages = msgs.map((m) => ({ role: m.role, content: m.content }));
    const systemPrompt = (systemPromptOverride ?? $settings.system_prompt)?.trim();
    if (systemPrompt) apiMessages.unshift({ role: 'system', content: systemPrompt });
    return apiMessages;
  }

  // ---------- Stream / send ----------
  /**
   * Send a message to one Arena slot. Streams response.
   * @param {string} slot - 'A'|'B'|'C'|'D'
   * @param {string} modelId
   * @param {string|Array} apiContent - Full content sent to model API (includes rules, web context, etc.)
   * @param {string|Array} [displayContent] - What shows in the UI bubble (question only, no rules). Falls back to apiContent.
   * @param {Function} [onStreamDone]
   */
  async function sendToSlot(slot, modelId, apiContent, displayContent, onStreamDone) {
    setRunning(slot, true);
    setSlotError(slot, '');

    // Display-friendly message: just the question (no rules clutter)
    const userMsg = {
      id: generateId(),
      role: 'user',
      content: displayContent || apiContent,
      createdAt: Date.now(),
    };
    pushMessage(slot, userMsg);

    const assistantMsgId = generateId();
    pushMessage(slot, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      stats: null,
      modelId,
      createdAt: Date.now(),
    });

    // API messages: use full content with rules for the user message
    const slotOpts = getSettingsForSlot(slot);
    const displayMsgs = getMessages(slot);
    const apiMsgs = displayMsgs.map((m) => {
      // Replace the display user message with the full API content (rules + question)
      if (m.id === userMsg.id) return { role: 'user', content: apiContent };
      return { role: m.role, content: m.content };
    });
    const systemPrompt = (slotOpts.system_prompt ?? $settings.system_prompt)?.trim();
    if (systemPrompt) apiMsgs.unshift({ role: 'system', content: systemPrompt });
    const apiMessages = apiMsgs;
    const controller = new AbortController();
    aborters[slot] = controller;

    let fullContent = '';
    let usage = null;
    let elapsedMs = 0;
    lastSampleAt = Date.now();
    lastSampleTokens = 0;

    try {
      const result = await streamChatCompletion({
        model: modelId,
        messages: apiMessages,
        options: {
          temperature: slotOpts.temperature,
          max_tokens: slotOpts.max_tokens,
          top_p: slotOpts.top_p,
          top_k: slotOpts.top_k,
          repeat_penalty: slotOpts.repeat_penalty,
          presence_penalty: slotOpts.presence_penalty,
          frequency_penalty: slotOpts.frequency_penalty,
          stop: slotOpts.stop?.length ? slotOpts.stop : undefined,
          ttl: slotOpts.model_ttl_seconds,
        },
        signal: controller.signal,
        onDone() {
          setRunning(slot, false);
          onStreamDone?.();
        },
        onChunk(chunk) {
          fullContent += chunk;
          if (detectLoop(fullContent)) {
            controller.abort();
            return;
          }
          liveTokens.set(Math.max(1, Math.ceil(fullContent.length / 4)));
          const now = Date.now();
          if (now - lastSampleAt >= 1000) {
            const tok = Math.max(1, Math.ceil(fullContent.length / 4));
            const rate = (tok - lastSampleTokens) / ((now - lastSampleAt) / 1000);
            if (rate >= 0) pushTokSample(rate);
            lastSampleAt = now;
            lastSampleTokens = tok;
          }
          updateMessage(slot, assistantMsgId, { content: fullContent, modelId });
        },
        onUsage(u) {
          usage = u;
        },
      });
      elapsedMs = result.elapsedMs ?? 0;
      if (result.usage) usage = result.usage;
      if ($settings.audio_enabled && !result?.aborted) playComplete($settings.audio_volume);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setSlotError(slot, err?.message || 'Failed to get response. Is your model server running and the model loaded?');
      }
      try {
        updateMessage(slot, assistantMsgId, { content: fullContent || '', stats: null, modelId });
      } catch (_) { /* message list may have been cleared (e.g. Next question); ignore */ }
      onStreamDone?.();
      return;
    } finally {
      setRunning(slot, false);
      aborters[slot] = null;
    }

    const estimatedTokens = Math.max(1, Math.ceil(fullContent.length / 4));
    const stats = {
      prompt_tokens: usage?.prompt_tokens ?? 0,
      completion_tokens: usage?.completion_tokens ?? estimatedTokens,
      elapsed_ms: elapsedMs,
      estimated: !usage?.completion_tokens,
    };
    updateMessage(slot, assistantMsgId, { content: fullContent, stats, modelId });
  }

  async function sendUserMessage(text, imageDataUrls = []) {
    if (!text || !String(text).trim() || $isStreaming) return;
    chatError.set(null);

    let effectiveText = String(text).trim();
    const webMode = get(arenaWebSearchMode);
    if (webMode === 'all' && get(webSearchForNextMessage)) {
      // Stay connected: don't turn off webSearchForNextMessage after send.
      // User toggles it off manually via the globe button.
      webSearchInProgress.set(true);
      try {
        const searchResult = await searchDuckDuckGo(effectiveText);
        webSearchConnected.set(true);
        const formatted = formatSearchResultForChat(effectiveText, searchResult);
        effectiveText = formatted + '\n\n---\nUser question: ' + effectiveText;
      } catch (e) {
        webSearchConnected.set(false);
        chatError.set(e?.message || 'Web search failed. Click the globe to retry or send without internet.');
        webSearchInProgress.set(false);
        throw e; // Propagate so ChatInput restores the user's typed message.
      }
      webSearchInProgress.set(false);
    }

    const n = get(arenaPanelCount);
    const slotsActive = ['A', ...(n >= 2 ? ['B'] : []), ...(n >= 3 ? ['C'] : []), ...(n >= 4 ? ['D'] : [])];
    const isJudge = get(arenaSlotAIsJudge);
    let selected = [
      { slot: 'A', modelId: $dashboardModelA },
      { slot: 'B', modelId: $dashboardModelB },
      { slot: 'C', modelId: $dashboardModelC },
      { slot: 'D', modelId: $dashboardModelD },
    ].filter((s) => s.modelId && slotsActive.includes(s.slot));
    if (isJudge) selected = selected.filter((s) => s.slot !== 'A');

    if (!selected.length) {
      chatError.set(isJudge ? 'Select at least one responder (B, C, or D) before sending.' : 'Select at least one model (A–D) before sending.');
      return;
    }

    runId += 1;
    const currentRun = runId;
    liveTokens.set(0);
    isStreaming.set(true);
    let streamDoneCount = 0;
    const onStreamDone = () => {
      streamDoneCount += 1;
      if (streamDoneCount >= selected.length) {
        isStreaming.set(false);
        liveTokens.set(null);
        liveTokPerSec.set(null);
      }
    };

    try {
      const rulesPrefix = (typeof contestRules === 'string' ? contestRules : '').trim() ? (contestRules.trim() + '\n\n---\n\n') : '';
      const textWithRules = rulesPrefix + effectiveText;
      const urls = Array.isArray(imageDataUrls) ? imageDataUrls : [];
      const needResize = urls.length > 0 && !selected.every((s) => shouldSkipImageResizeForVision(s.modelId));
      const urlsForApi = urls.length ? (needResize ? await resizeImageDataUrlsForVision(urls) : urls) : [];
      // API content: full text with rules (what the model sees)
      const content = urlsForApi.length
        ? [
            { type: 'text', text: textWithRules },
            ...urlsForApi.map((url) => ({
              type: 'image_url',
              image_url: { url, ...(needResize ? { detail: 'low' } : {}) },
            })),
          ]
        : textWithRules;
      // Display content: question only, no rules (what the user sees in the panel)
      const displayContent = urlsForApi.length
        ? [
            { type: 'text', text: effectiveText },
            ...urlsForApi.map((url) => ({
              type: 'image_url',
              image_url: { url, ...(needResize ? { detail: 'low' } : {}) },
            })),
          ]
        : effectiveText;

      if (runId !== currentRun) return;

      /* Eject every loaded model so the first contestant has full VRAM (best-effort; don't block if helper down). */
      arenaTransitionPhase = 'ejecting';
      await unloadAllLoadedModels(get(lmStudioUnloadHelperUrl));
      const allArenaModelIds = [
        get(dashboardModelA),
        get(dashboardModelB),
        get(dashboardModelC),
        get(dashboardModelD),
      ].filter(Boolean);
      await waitUntilUnloaded(allArenaModelIds, { pollIntervalMs: 400, timeoutMs: 25000 });
      await new Promise((r) => setTimeout(r, 1500));
      arenaTransitionPhase = null;
      if (runId !== currentRun) return;

      if (sequential) {
        let completedCount = 0;
        let failedSlots = [];
        for (let i = 0; i < selected.length; i++) {
          if (runId !== currentRun) break;
          const s = selected[i];
          try {
            await sendToSlot(s.slot, s.modelId, content, displayContent, onStreamDone);
            completedCount++;
          } catch (slotErr) {
            failedSlots.push(s.slot);
            setSlotError(s.slot, slotErr?.message || 'Failed to get response.');
            onStreamDone(); // count it as done even on failure
          }
          const next = selected[i + 1];
          if (!next?.modelId || runId !== currentRun) continue;
          arenaTransitionPhase = 'ejecting';
          try {
            if (s.modelId) await unloadModel(s.modelId);
          } catch (_) { /* LM Studio may not support unload or already unloaded; continue */ }
          if (runId !== currentRun) break;
          arenaTransitionPhase = 'loading';
          try {
            await loadModel(next.modelId);
          } catch (_) { /* Load may fail or already loaded; sendToSlot will load on demand */ }
          arenaTransitionPhase = null;
        }
        if (failedSlots.length > 0 && completedCount > 0) {
          chatError.set(`${completedCount}/${selected.length} models completed. Failed: ${failedSlots.join(', ')}.`);
        }
      } else {
        await Promise.allSettled(selected.map((s) => sendToSlot(s.slot, s.modelId, content, displayContent, onStreamDone)));
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        chatError.set(err?.message || 'Something went wrong. Try again.');
      }
    } finally {
      arenaTransitionPhase = null;
      isStreaming.set(false);
      liveTokens.set(null);
      liveTokPerSec.set(null);
    }
  }

  function stopAll() {
    runId += 1;
    arenaTransitionPhase = null;
    for (const slot of ['A', 'B', 'C', 'D']) {
      try { aborters[slot]?.abort(); } catch (_) {}
      aborters[slot] = null;
      setRunning(slot, false);
    }
    isStreaming.set(false);
    liveTokens.set(null);
    liveTokPerSec.set(null);
  }

  /** Go to previous question index (display only; does not send). */
  function prevQuestion() {
    if (currentQuestionTotal === 0) return;
    questionIndex = Math.max(0, questionIndex - 1);
    if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
  }

  /** Advance question index without sending (for "next" arrow when only navigating). */
  function advanceQuestionIndex() {
    if (currentQuestionTotal === 0) return;
    questionIndex = (questionIndex + 1) % currentQuestionTotal;
    if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
  }

  /** Jump to a specific question by number (1-based). Does not send. */
  function jumpToQuestion(num) {
    const n = parseInt(num, 10);
    if (Number.isNaN(n) || currentQuestionTotal === 0) return;
    questionIndex = Math.max(0, Math.min(n - 1, currentQuestionTotal - 1));
    if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
  }

  /** Ask: send the currently selected question to the models. (Standard test flow: select question, click Ask.) */
  function askCurrentQuestion() {
    if ($isStreaming) return;
    const questions = parsedQuestions;
    if (questions.length === 0) return;
    const idx = questionIndex % questions.length;
    const toSend = (questions[idx] && String(questions[idx]).trim()) || '';
    if (!toSend) return;
    messagesA = [];
    messagesB = [];
    messagesC = [];
    messagesD = [];
    chatError.set(null);
    if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
    sendUserMessage(toSend, []).catch((e) => {
      chatError.set(e?.message || 'Failed to send question.');
    });
  }

  /** Next: advance to the next question AND immediately send it. One-click to keep the competition moving. */
  function askNextQuestion() {
    if ($isStreaming) return;
    const questions = parsedQuestions;
    if (questions.length === 0) return;
    // Advance to next question
    questionIndex = (questionIndex + 1) % questions.length;
    const idx = questionIndex % questions.length;
    const toSend = (questions[idx] && String(questions[idx]).trim()) || '';
    if (!toSend) return;
    messagesA = [];
    messagesB = [];
    messagesC = [];
    messagesD = [];
    chatError.set(null);
    if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume);
    sendUserMessage(toSend, []).catch((e) => {
      chatError.set(e?.message || 'Failed to send question.');
    });
  }

  /** Run All: iterate through all questions, send each, optionally judge each, then advance. */
  async function runAllQuestions() {
    if ($isStreaming || runAllActive) return;
    const questions = parsedQuestions;
    if (questions.length === 0) return;
    const shouldJudge = $arenaSlotAIsJudge && $dashboardModelA;
    const ok = await confirm({
      title: 'Run all questions',
      message: `This will run ${questions.length} question${questions.length > 1 ? 's' : ''} sequentially${shouldJudge ? ' with judgment after each' : ''}. This may take a while.`,
      confirmLabel: 'Run all',
      cancelLabel: 'Cancel',
      danger: false,
    });
    if (!ok) return;
    runAllActive = true;
    runAllProgress = { current: 0, total: questions.length };
    try {
      for (let i = 0; i < questions.length; i++) {
        if (!runAllActive) break; // user cancelled
        questionIndex = i;
        runAllProgress = { current: i + 1, total: questions.length };
        const toSend = (questions[i] && String(questions[i]).trim()) || '';
        if (!toSend) continue;
        // Clear slot messages for this question
        messagesA = [];
        messagesB = [];
        messagesC = [];
        messagesD = [];
        chatError.set(null);
        // Send question to models
        try {
          await sendUserMessage(toSend, []);
        } catch (e) {
          chatError.set(e?.message || `Failed on question ${i + 1}.`);
          continue;
        }
        // Wait for all streams to finish
        await new Promise((r) => {
          const check = () => {
            if (!running.A && !running.B && !running.C && !running.D) { r(); return; }
            setTimeout(check, 500);
          };
          check();
        });
        // Run judgment if judge mode is on
        if (shouldJudge && runAllActive) {
          const n = get(arenaPanelCount);
          const hasResponses = (n >= 2 && messagesB.length > 0) || (n >= 3 && messagesC.length > 0) || (n >= 4 && messagesD.length > 0);
          if (hasResponses) {
            try {
              await runJudgment();
            } catch (e) {
              chatError.set(e?.message || `Judgment failed on question ${i + 1}.`);
            }
            // Wait for judge to finish
            await new Promise((r) => {
              const check = () => {
                if (!running.A) { r(); return; }
                setTimeout(check, 500);
              };
              check();
            });
          }
        }
      }
    } finally {
      runAllActive = false;
      runAllProgress = { current: 0, total: 0 };
    }
  }

  function stopRunAll() {
    runAllActive = false;
    stopAll();
  }

  async function confirmResetScores() {
    const ok = await confirm({
      title: 'Reset all scores',
      message: 'Clear B/C/D score totals? This cannot be undone.',
      confirmLabel: 'Reset',
      cancelLabel: 'Cancel',
      danger: true
    });
    if (ok) {
      resetArenaScores();
      arenaSettingsOpen = false;
    }
  }

  async function confirmEjectAll() {
    const ok = await confirm({
      title: 'Eject all models',
      message: 'Unload all loaded models to free VRAM. You can load again from the sidebar.',
      confirmLabel: 'Eject all',
      cancelLabel: 'Cancel',
      danger: false
    });
    if (ok) {
      arenaSettingsOpen = false;
      ejectAllModels();
    }
  }

  // contentToText imported from arenaLogic.js

  // ---------- Judgment & eject ----------
  async function runJudgment() {
    if ($arenaSlotAIsJudge && $isStreaming) return;
    if (running.A) return;
    const judgeId = get(dashboardModelA);
    if (!judgeId) {
      chatError.set('Select a model in Slot A to use as judge.');
      return;
    }
    const feedback = typeof judgeFeedback === 'string' ? judgeFeedback.trim() : '';
    const n = get(arenaPanelCount);
    const slotsWithResponses = [
      n >= 2 && messagesB.length ? { slot: 'B', msgs: messagesB } : null,
      n >= 3 && messagesC.length ? { slot: 'C', msgs: messagesC } : null,
      n >= 4 && messagesD.length ? { slot: 'D', msgs: messagesD } : null,
    ].filter(Boolean);
    if (!slotsWithResponses.length) {
      chatError.set('Run a prompt with at least one responder (B, C, or D) first.');
      return;
    }
    /* Eject all loaded models so the judge gets full VRAM — same as run start: eject then wait until gone. */
    try {
      arenaTransitionPhase = 'ejecting';
      await unloadAllLoadedModels(get(lmStudioUnloadHelperUrl));
      const contestantIds = [
        n >= 2 && get(dashboardModelB) ? get(dashboardModelB) : null,
        n >= 3 && get(dashboardModelC) ? get(dashboardModelC) : null,
        n >= 4 && get(dashboardModelD) ? get(dashboardModelD) : null,
      ].filter(Boolean);
      await waitUntilUnloaded(contestantIds, { pollIntervalMs: 400, timeoutMs: 25000 });
      await new Promise((r) => setTimeout(r, 1500));
      arenaTransitionPhase = 'loading';
      try {
        await loadModel(judgeId);
      } catch (_) { /* Load may fail or already loaded; stream will trigger load on demand */ }
      arenaTransitionPhase = null;
    } finally {
      arenaTransitionPhase = null;
    }

    const lastUserMsg = slotsWithResponses[0].msgs.filter((m) => m.role === 'user').pop();
    const promptText = lastUserMsg ? contentToText(lastUserMsg.content) : '';
    let judgeWebContext = '';
    if (get(arenaWebSearchMode) === 'judge' && promptText.trim()) {
      webSearchInProgress.set(true);
      arenaTransitionPhase = 'judge_web';
      judgeWebMessageIndex = Math.floor(Math.random() * JUDGE_WEB_LINES.length);
      try {
        const searchResult = await searchDuckDuckGo(promptText);
        webSearchConnected.set(true);
        judgeWebContext = formatSearchResultForChat(promptText, searchResult);
      } catch (_) {
        webSearchConnected.set(false);
      } finally {
        arenaTransitionPhase = null;
        webSearchInProgress.set(false);
      }
    }
    const answerKeyTrimmed = currentQuestionAnswer;
    const { messages } = buildJudgePrompt({
      slotsWithResponses,
      answerKeyTrimmed,
      judgeWebContext,
      promptText,
      judgeFeedback: feedback,
      judgeInstructions,
    });
    chatError.set(null);
    setRunning('A', true);
    setSlotError('A', '');
    const assistantMsgId = generateId();
    pushMessage('A', {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      stats: null,
      modelId: judgeId,
      createdAt: Date.now(),
    });
    const controller = new AbortController();
    aborters['A'] = controller;
    let fullContent = '';
    const judgeOpts = getSettingsForSlot('A');
    try {
      await streamChatCompletion({
        model: judgeId,
        messages,
        options: {
          temperature: judgeOpts.temperature,
          max_tokens: judgeOpts.max_tokens,
          top_p: judgeOpts.top_p,
          top_k: judgeOpts.top_k,
          repeat_penalty: judgeOpts.repeat_penalty,
          presence_penalty: judgeOpts.presence_penalty,
          frequency_penalty: judgeOpts.frequency_penalty,
          stop: judgeOpts.stop?.length ? judgeOpts.stop : undefined,
          ttl: judgeOpts.model_ttl_seconds,
        },
        signal: controller.signal,
        onChunk(chunk) {
          fullContent += chunk;
          updateMessage('A', assistantMsgId, { content: fullContent, modelId: judgeId });
        },
      });
      const estimatedTokens = Math.max(1, Math.ceil(fullContent.length / 4));
      updateMessage('A', assistantMsgId, { content: fullContent, stats: { completion_tokens: estimatedTokens, estimated: true }, modelId: judgeId });
      const roundScores = parseJudgeScores(fullContent);
      if (Object.keys(roundScores).length > 0) {
        // Track per-question history
        const qIdx = questionIndex % Math.max(1, parsedQuestions.length);
        const qText = parsedQuestions[qIdx] || '(free-form prompt)';
        scoreHistory = addScoreRound(scoreHistory, qIdx, qText, roundScores);
        arenaScores = computeTotals(scoreHistory);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setSlotError('A', err?.message || 'Judge request failed.');
      }
      updateMessage('A', assistantMsgId, { content: fullContent || '', stats: null, modelId: judgeId });
    } finally {
      setRunning('A', false);
      aborters['A'] = null;
    }
  }

  async function ejectAllModels() {
    if (ejectBusy) return;
    ejectBusy = true;
    ejectMessage = null;
    chatError.set(null);
    try {
      const result = await unloadAllLoadedModels(get(lmStudioUnloadHelperUrl));
      if (result?.ok) {
        ejectMessage = 'All models ejected.';
      } else {
        ejectMessage = 'Unload helper not running. Run start_atom_ui.bat or start_unload_helper.bat.';
      }
      setTimeout(() => { ejectMessage = null; }, 4000);
    } finally {
      ejectBusy = false;
    }
  }

  const canRunJudgment = $derived(
    $arenaSlotAIsJudge &&
    $dashboardModelA &&
    !$isStreaming &&
    !running.A &&
    (($arenaPanelCount >= 2 && messagesB.length > 0) ||
     ($arenaPanelCount >= 3 && messagesC.length > 0) ||
     ($arenaPanelCount >= 4 && messagesD.length > 0))
  );

  // ---------- Ask the Judge (side conversation) ----------
  async function askTheJudge() {
    if (askJudgeLoading || !askJudgeQuestion.trim()) return;
    const judgeId = get(dashboardModelA);
    if (!judgeId) {
      chatError.set('Select a model in Slot A to use as judge.');
      return;
    }
    askJudgeLoading = true;
    askJudgeReply = '';
    chatError.set(null);

    // Build context: original question, model responses, judge's scoring
    const n = get(arenaPanelCount);
    const slotsWithResponses = [
      n >= 2 && messagesB.length ? { slot: 'B', msgs: messagesB } : null,
      n >= 3 && messagesC.length ? { slot: 'C', msgs: messagesC } : null,
      n >= 4 && messagesD.length ? { slot: 'D', msgs: messagesD } : null,
    ].filter(Boolean);

    const lastUserMsg = slotsWithResponses.length
      ? slotsWithResponses[0].msgs.filter((m) => m.role === 'user').pop()
      : null;
    const promptText = lastUserMsg ? contentToText(lastUserMsg.content) : '';

    const contextParts = [
      'You are a judge in a model arena competition. You were given an answer key and contest rules (see below) to use when scoring. The user may ask you about your scoring, the answer key, or how you use it. Answer thoughtfully and concisely; do NOT re-score.',
      '',
    ];
    // Answer for current question (if any); otherwise judge used web or own knowledge
    const answerForQuestion = currentQuestionAnswer;
    if (answerForQuestion) {
      contextParts.push('--- ANSWER KEY (use this to evaluate accuracy; it was provided to you when you scored) ---', answerForQuestion, '');
    } else {
      contextParts.push('--- ANSWER KEY ---', '(None provided for this question; you used web or your own knowledge.)', '');
    }
    // Contest rules (Arena settings)
    const rulesTrimmed = typeof contestRules === 'string' ? contestRules.trim() : '';
    if (rulesTrimmed) {
      contextParts.push('--- CONTEST RULES ---', rulesTrimmed, '');
    }
    contextParts.push('--- ORIGINAL PROMPT ---', promptText || '(none)', '');
    for (const { slot, msgs } of slotsWithResponses) {
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
      const text = lastAssistant ? contentToText(lastAssistant.content) : '';
      contextParts.push(`--- MODEL ${slot} RESPONSE ---`, text.trim() || '(no response)', '');
    }
    // Include judge's last scoring if available
    const lastJudgeMsg = [...messagesA].reverse().find((m) => m.role === 'assistant');
    if (lastJudgeMsg) {
      contextParts.push('--- YOUR PREVIOUS SCORING ---', contentToText(lastJudgeMsg.content).trim(), '');
    }
    contextParts.push('--- USER QUESTION ---', askJudgeQuestion.trim());

    const systemContent = answerForQuestion
      ? 'You are a competition judge. You have been given the answer key and (if any) contest rules in the user message. Use them when answering questions about your scoring. Do NOT re-score — just explain your reasoning.'
      : 'You are a competition judge. Answer the user\'s question about your scoring thoughtfully and concisely. Do NOT re-score — just explain your reasoning.';

    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: contextParts.join('\n') },
    ];

    const controller = new AbortController();
    const askJudgeOpts = getSettingsForSlot('A');
    try {
      await streamChatCompletion({
        model: judgeId,
        messages,
        options: {
          temperature: askJudgeOpts.temperature,
          max_tokens: askJudgeOpts.max_tokens,
          top_p: askJudgeOpts.top_p,
        },
        signal: controller.signal,
        onChunk(chunk) {
          askJudgeReply += chunk;
        },
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        askJudgeReply = `Error: ${err?.message || 'Request failed.'}`;
      }
    } finally {
      askJudgeLoading = false;
    }
  }

  function lastTps(msgs) {
    const last = [...(msgs || [])].reverse().find((m) => m.role === 'assistant' && m.stats);
    if (!last?.stats) return null;
    const { completion_tokens, elapsed_ms } = last.stats;
    if (elapsed_ms <= 0) return null;
    return (completion_tokens / (elapsed_ms / 1000)).toFixed(1);
  }
  const tpsA = $derived(lastTps(messagesA));
  const tpsB = $derived(lastTps(messagesB));
  const tpsC = $derived(lastTps(messagesC));
  const tpsD = $derived(lastTps(messagesD));

  // ---------- Layout (resizable panel widths) ----------
  function loadPanelWidths() {
    if (typeof localStorage === 'undefined') return [25, 25, 25, 25];
    try { const r = JSON.parse(localStorage.getItem('arenaPanelWidths') || '[]'); return r.length === 4 ? r : [25, 25, 25, 25]; } catch { return [25, 25, 25, 25]; }
  }
  let panelWidths = $state(loadPanelWidths());
  function savePanelWidths() {
    if (typeof localStorage !== 'undefined') localStorage.setItem('arenaPanelWidths', JSON.stringify(panelWidths));
  }
  const gridCols = $derived.by(() => {
    const n = $arenaPanelCount;
    const ws = panelWidths.slice(0, n);
    const sum = ws.reduce((a, b) => a + b, 0) || 100;
    return ws.map((w) => (w / sum * 100).toFixed(2) + '%').join(' ');
  });

  let resizing = $state(-1);
  let resizeStartX = $state(0);
  let resizeStartWidths = $state([]);
  let gridEl = $state(null);

  function startResize(index, e) {
    resizing = index;
    resizeStartX = e.clientX;
    resizeStartWidths = [...panelWidths];
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }
  function onResizeMove(e) {
    if (resizing < 0 || !gridEl) return;
    const totalW = gridEl.getBoundingClientRect().width;
    const deltaPct = ((e.clientX - resizeStartX) / totalW) * 100;
    const left = Math.max(10, resizeStartWidths[resizing] + deltaPct);
    const right = Math.max(10, resizeStartWidths[resizing + 1] - deltaPct);
    panelWidths[resizing] = left;
    panelWidths[resizing + 1] = right;
  }
  function endResize() {
    if (resizing < 0) return;
    resizing = -1;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    savePanelWidths();
  }
  $effect(() => {
    if (typeof document === 'undefined') return;
    if (resizing < 0) return;
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', endResize);
    return () => {
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', endResize);
    };
  });

  /* ── Responsive: detect narrow viewport ── */
  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1200);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => { windowWidth = window.innerWidth; };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
  const isMobile = $derived(windowWidth < 768);
  const isTablet = $derived(windowWidth >= 768 && windowWidth < 1024);
  const effectiveCols = $derived.by(() => {
    const n = $arenaPanelCount;
    if (isMobile) return 1;
    if (isTablet) return Math.min(n, 2);
    return n;
  });
  const responsiveGridCols = $derived.by(() => {
    if (isMobile || isTablet) return `repeat(${effectiveCols}, minmax(0, 1fr))`;
    return gridCols;
  });

  /** Refs for panel message areas — scroll to bottom when messages change. */
  let arenaScrollA = $state(/** @type {HTMLDivElement | null} */ (null));
  let arenaScrollB = $state(/** @type {HTMLDivElement | null} */ (null));
  let arenaScrollC = $state(/** @type {HTMLDivElement | null} */ (null));
  let arenaScrollD = $state(/** @type {HTMLDivElement | null} */ (null));
  function scrollPanelToBottom(el) {
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }
  $effect(() => {
    messagesA; arenaScrollA && scrollPanelToBottom(arenaScrollA);
  });
  $effect(() => {
    messagesB; arenaScrollB && scrollPanelToBottom(arenaScrollB);
  });
  $effect(() => {
    messagesC; arenaScrollC && scrollPanelToBottom(arenaScrollC);
  });
  $effect(() => {
    messagesD; arenaScrollD && scrollPanelToBottom(arenaScrollD);
  });
</script>

<div
  class="h-full min-h-0 flex flex-col"
  role="region"
  aria-label="Arena drop zone"
  ondragover={(e) => { e.preventDefault(); e.stopPropagation(); }}
  ondrop={(e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (files?.length) pendingDroppedFiles.set(files);
  }}
>
  <!-- === Header: model cards A–D (selector + score) === -->
  <header
    class="shrink-0 grid gap-2 px-3 py-1.5 border-b items-stretch"
    style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border); z-index: 100; grid-template-columns: {windowWidth < 1200 ? 'repeat(2, minmax(0, 1fr))' : 'repeat(' + $arenaPanelCount + ', minmax(0, 1fr))'};">
    {#if $arenaPanelCount >= 1}
      <div
        class="flex items-center gap-2 rounded border px-2 py-1 min-h-0 transition-all"
        class:model-card-active={running.A}
        style="background-color: var(--ui-bg-main); border-color: {running.A ? '#3b82f6' : 'var(--ui-border)'};">
        <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">A</span>
        <div class="flex-1 min-w-0"><ModelSelectorSlot slot="A" /></div>
        <span class="text-[11px] font-bold shrink-0 w-6 text-right" style="color: #3b82f6;">—</span>
      </div>
    {/if}
    {#if $arenaPanelCount >= 2}
      <div
        class="flex items-center gap-2 rounded border px-2 py-1 min-h-0 transition-all"
        class:model-card-active={running.B}
        style="background-color: var(--ui-bg-main); border-color: {running.B ? '#10b981' : 'var(--ui-border)'};">
        <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">B</span>
        <div class="flex-1 min-w-0"><ModelSelectorSlot slot="B" /></div>
        <span class="text-[11px] font-bold shrink-0 tabular-nums" style="color: #10b981;">{arenaScores.B}</span>
      </div>
    {/if}
    {#if $arenaPanelCount >= 3}
      <div
        class="flex items-center gap-2 rounded border px-2 py-1 min-h-0 transition-all"
        class:model-card-active={running.C}
        style="background-color: var(--ui-bg-main); border-color: {running.C ? '#f59e0b' : 'var(--ui-border)'};">
        <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">C</span>
        <div class="flex-1 min-w-0"><ModelSelectorSlot slot="C" /></div>
        <span class="text-[11px] font-bold shrink-0 tabular-nums" style="color: #f59e0b;">{arenaScores.C}</span>
      </div>
    {/if}
    {#if $arenaPanelCount >= 4}
      <div
        class="flex items-center gap-2 rounded border px-2 py-1 min-h-0 transition-all"
        class:model-card-active={running.D}
        style="background-color: var(--ui-bg-main); border-color: {running.D ? '#8b5cf6' : 'var(--ui-border)'};">
        <span class="text-[10px] font-bold w-4 shrink-0" style="color: var(--ui-text-secondary);">D</span>
        <div class="flex-1 min-w-0"><ModelSelectorSlot slot="D" /></div>
        <span class="text-[11px] font-bold shrink-0 tabular-nums" style="color: #8b5cf6;">{arenaScores.D}</span>
      </div>
    {/if}
  </header>

  <!-- === Arena control bar: Question | Run | Web | Judge | Tools === -->
  <div
    class="arena-question-bar shrink-0 flex items-center gap-0 px-4 py-2.5 border-b"
    style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);">
    <!-- 1. Question: nav only -->
    <div class="arena-bar-section flex items-center gap-1" aria-label="Question">
      <div class="flex items-center h-8 rounded-md overflow-hidden border" style="border-color: var(--ui-border); background: var(--ui-input-bg);">
        <button type="button" class="h-full px-2.5 text-xs font-medium disabled:opacity-40 transition-opacity" style="color: var(--ui-text-secondary);" disabled={currentQuestionTotal === 0 || currentQuestionNum <= 1} onclick={prevQuestion} aria-label="Previous question">←</button>
        {#if currentQuestionTotal > 0}
          <select
            class="h-full min-w-[4.5rem] max-w-[14rem] pl-2 pr-7 text-xs font-semibold tabular-nums border-l border-r bg-transparent cursor-pointer"
            style="border-color: var(--ui-border); color: var(--ui-text-primary);"
            aria-label="Current question"
            value={currentQuestionNum}
            onchange={(e) => jumpToQuestion(e.currentTarget.value)}>
            {#each Array(currentQuestionTotal) as _, i}
              {@const qPreview = parsedQuestions[i] ? parsedQuestions[i].slice(0, 50) + (parsedQuestions[i].length > 50 ? '…' : '') : ''}
              <option value={i + 1}>Q{i + 1}{qPreview ? ': ' + qPreview : ''}</option>
            {/each}
          </select>
          <span class="h-full flex items-center px-2 text-xs tabular-nums" style="color: var(--ui-text-secondary);">/ {currentQuestionTotal}</span>
        {:else}
          <span class="px-2 text-xs" style="color: var(--ui-text-secondary);">—</span>
        {/if}
        <button type="button" class="h-full px-2.5 text-xs font-medium disabled:opacity-40 transition-opacity" style="color: var(--ui-text-secondary);" disabled={currentQuestionTotal === 0 || currentQuestionNum >= currentQuestionTotal} onclick={advanceQuestionIndex} aria-label="Next question">→</button>
      </div>
    </div>
    <div class="arena-bar-divider" aria-hidden="true"></div>
    <!-- 2. Run: Ask + Next -->
    <div class="arena-bar-section flex items-center gap-2" aria-label="Run">
      <button type="button" class="h-8 px-4 rounded-md text-xs font-semibold shrink-0 disabled:opacity-50 transition-opacity" style="background-color: var(--ui-accent); color: var(--ui-bg-main);" disabled={$isStreaming || currentQuestionTotal === 0} onclick={askCurrentQuestion} aria-label="Ask this question" title="Send the currently selected question to the models">Ask</button>
      <button type="button" class="h-8 px-3 rounded-md text-xs font-semibold shrink-0 disabled:opacity-50 transition-opacity border" style="border-color: var(--ui-accent); color: var(--ui-accent); background: transparent;" disabled={$isStreaming || currentQuestionTotal === 0 || currentQuestionNum >= currentQuestionTotal} onclick={askNextQuestion} aria-label="Next question and ask" title="Advance to next question and send it">Next</button>
      {#if runAllActive}
        <button type="button" class="h-8 px-3 rounded-md text-xs font-semibold shrink-0 transition-opacity" style="background: var(--ui-accent-hot, #dc2626); color: white;" onclick={stopRunAll} title="Stop Run All">Stop ({runAllProgress.current}/{runAllProgress.total})</button>
      {:else}
        <button type="button" class="h-8 px-3 rounded-md text-xs font-medium shrink-0 disabled:opacity-50 transition-opacity border" style="border-color: var(--ui-border); color: var(--ui-text-secondary); background: var(--ui-input-bg);" disabled={$isStreaming || currentQuestionTotal < 2} onclick={runAllQuestions} aria-label="Run all questions" title="Run all questions sequentially{$arenaSlotAIsJudge ? ' with judgment' : ''}">Run All</button>
      {/if}
    </div>
    <div class="arena-bar-divider" aria-hidden="true"></div>
    <!-- 3. Web: globe + who gets it -->
    <div class="arena-bar-section flex items-center gap-2" aria-label="Web">
      <button
        type="button"
        class="arena-globe-btn relative flex items-center justify-center shrink-0 w-8 h-8 rounded-md border transition-colors"
        class:arena-globe-active={$webSearchForNextMessage}
        style="border-color: {$webSearchForNextMessage ? 'var(--ui-accent)' : 'var(--ui-border)'}; background: {$webSearchForNextMessage ? 'color-mix(in srgb, var(--ui-accent) 14%, transparent)' : 'var(--ui-input-bg)'};"
        disabled={$isStreaming}
        title={arenaWebWarmingUp ? 'Connecting…' : $webSearchForNextMessage ? ($webSearchConnected ? 'Connected – click to disconnect' : 'Not connected – click to retry') : 'Connect to internet'}
        onclick={() => {
          const on = $webSearchForNextMessage;
          const connected = $webSearchConnected;
          if (on && !connected && !arenaWebWarmingUp) {
            arenaWebWarmUpAttempted = false;
            runArenaWarmUp();
            return;
          }
          if (on) {
            webSearchForNextMessage.set(false);
            webSearchConnected.set(false);
            return;
          }
          webSearchForNextMessage.set(true);
          runArenaWarmUp();
        }}
        aria-label={arenaWebWarmingUp ? 'Connecting' : $webSearchForNextMessage ? 'Web connected' : 'Connect to web'}
        aria-pressed={$webSearchForNextMessage}
      >
        <span class="text-base leading-none" class:arena-globe-spin={arenaWebWarmingUp} aria-hidden="true">🌐</span>
        {#if $webSearchForNextMessage}
          {#if $webSearchConnected}
            <span class="arena-globe-dot arena-globe-dot-green" aria-hidden="true"></span>
          {:else}
            <span class="arena-globe-dot arena-globe-dot-red" class:arena-globe-dot-pulse={arenaWebWarmingUp} aria-hidden="true"></span>
          {/if}
        {/if}
      </button>
      <div class="flex h-8 rounded-md border overflow-hidden" style="border-color: var(--ui-border); background: var(--ui-input-bg); opacity: {$webSearchForNextMessage && $webSearchConnected ? '1' : '0.5'};">
        <button type="button" class="arena-web-tab h-full px-2.5 text-[11px] font-medium" class:active={$arenaWebSearchMode === 'none'} onclick={() => { arenaWebSearchMode.set('none'); if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume); }} title="No web">None</button>
        <button type="button" class="arena-web-tab h-full px-2.5 text-[11px] font-medium border-l" class:active={$arenaWebSearchMode === 'all'} style="border-color: var(--ui-border);" onclick={() => { arenaWebSearchMode.set('all'); if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume); }} title="All models">All</button>
        <button type="button" class="arena-web-tab h-full px-2.5 text-[11px] font-medium border-l" class:active={$arenaWebSearchMode === 'judge'} style="border-color: var(--ui-border);" onclick={() => { arenaWebSearchMode.set('judge'); if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume); }} title="Judge only">Judge only</button>
      </div>
    </div>
    <div class="arena-bar-divider" aria-hidden="true"></div>
    <!-- 4. Judge: score B/C/D -->
    {#if $arenaSlotAIsJudge}
      <div class="arena-bar-section flex items-center" aria-label="Judge">
        <button type="button" class="h-8 px-4 rounded-md text-xs font-semibold shrink-0 disabled:opacity-50 transition-opacity" style="background-color: var(--ui-accent); color: var(--ui-bg-main);" disabled={!canRunJudgment} onclick={() => { if (canRunJudgment) runJudgment(); if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume); }} title="Score B/C/D using slot A">Judgment</button>
      </div>
      <div class="arena-bar-divider" aria-hidden="true"></div>
    {/if}
    <!-- Spacer: push tools right -->
    <div class="flex-1 min-w-4" aria-hidden="true"></div>
    <!-- 5. Tools: Reset + Settings -->
    <div class="arena-bar-section flex items-center gap-2" aria-label="Tools">
      <button
        type="button"
        class="flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium shrink-0 transition-opacity hover:opacity-90"
        style="border-color: var(--ui-accent-hot, #dc2626); color: var(--ui-accent-hot, #dc2626); background: transparent;"
        onclick={startOver}
        aria-label="Start over"
        title="Clear all responses, reset scores, go back to Q1">
        <span aria-hidden="true">⟲</span>
        <span>Start Over</span>
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium shrink-0 transition-opacity hover:opacity-90"
        style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-secondary);"
        onclick={() => { arenaSettingsOpen = true; if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume); }}
        aria-label="Arena settings"
        title="Questions, answer key, rules">
        <span aria-hidden="true">⚙</span>
        <span>Settings</span>
      </button>
    </div>
  </div>

  <!-- === Sticky question text bar (always visible above panels) === -->
  {#if currentQuestionTotal > 0 && currentQuestionText}
    <div
      class="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b"
      style="background-color: color-mix(in srgb, var(--ui-accent) 6%, var(--ui-bg-main)); border-color: var(--ui-border);"
    >
      <span class="text-xs font-bold tabular-nums shrink-0" style="color: var(--ui-accent);">Q{currentQuestionNum}</span>
      <span class="text-xs truncate" style="color: var(--ui-text-primary);" title={currentQuestionText}>{currentQuestionText}</span>
    </div>
  {/if}

  <!-- === Response panels A–D (resizable; panel A header has "Use as judge" checkbox) === -->
  <div
    bind:this={gridEl}
    class="flex-1 min-h-0 grid gap-2 p-3 atom-layout-transition relative grid-rows-[minmax(0,1fr)]"
    style="grid-template-columns: {responsiveGridCols};">
    {#if $arenaPanelCount >= 1}
    <div class="flex flex-col min-h-0 h-full overflow-hidden rounded-lg atom-panel-wrap border" style="background-color: var(--ui-bg-main); border-color: var(--ui-border);" role="region" aria-label="Model A panel" in:fly={{ x: 200, duration: 800, easing: quintOut }}>
      <div class="shrink-0 flex items-center justify-between gap-2 px-2 py-1.5 border-b text-[11px]" style="color: var(--ui-text-secondary); border-color: var(--ui-border);">
        <span class="font-medium">A</span>
        <label class="flex items-center gap-1.5 cursor-pointer select-none" title="When on, this model scores B/C/D responses when you click Judgment">
          <input type="checkbox" bind:checked={$arenaSlotAIsJudge} class="rounded w-3 h-3" style="accent-color: var(--ui-accent);" />
          <span style="color: var(--ui-text-primary);">Use as judge</span>
        </label>
      </div>
      {#if slotErrors.A}<div class="shrink-0 px-2 py-0.5 text-[10px]" style="color: var(--ui-accent-hot);">{slotErrors.A}</div>{/if}
      {#if optionsOpenSlot === 'A'}
        <div class="shrink-0 p-2 border-b text-xs" style="border-color: var(--ui-border); background-color: var(--ui-input-bg);">
          <p class="font-medium mb-1.5" style="color: var(--ui-text-secondary);">Model A settings</p>
          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center">
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-a-temp">Temperature</label>
            <input id="arena-opt-a-temp" type="number" step="0.1" min="0" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.A?.temperature ?? effectiveForA.temperature} oninput={slotOverrideInput('A', 'temperature')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-a-max">Max tokens</label>
            <input id="arena-opt-a-max" type="number" min="1" max="100000" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.A?.max_tokens ?? effectiveForA.max_tokens} oninput={slotOverrideInput('A', 'max_tokens')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-a-top_p">Top-P</label>
            <input id="arena-opt-a-top_p" type="number" step="0.05" min="0" max="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.A?.top_p ?? effectiveForA.top_p} oninput={slotOverrideInput('A', 'top_p')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-a-top_k">Top-K</label>
            <input id="arena-opt-a-top_k" type="number" min="1" max="200" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.A?.top_k ?? effectiveForA.top_k} oninput={slotOverrideInput('A', 'top_k')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-a-rp">Repeat penalty</label>
            <input id="arena-opt-a-rp" type="number" step="0.05" min="1" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.A?.repeat_penalty ?? effectiveForA.repeat_penalty} oninput={slotOverrideInput('A', 'repeat_penalty')} />
          </div>
          <label class="block mt-1.5 text-zinc-500 dark:text-zinc-400">System prompt template</label>
          <select class="w-full mb-0.5 px-1.5 py-0.5 rounded border text-xs" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" onchange={(e) => { const opt = ARENA_SYSTEM_PROMPT_TEMPLATES.find((t) => t.name === e.currentTarget?.value); if (opt?.prompt) applySystemPromptTemplate('A', opt.prompt); }} aria-label="System prompt template">
            {#each ARENA_SYSTEM_PROMPT_TEMPLATES as t}<option value={t.name}>{t.name}</option>{/each}
          </select>
          <label class="block mt-1 text-zinc-500 dark:text-zinc-400" for="arena-opt-a-sys">System prompt (optional)</label>
          <textarea id="arena-opt-a-sys" rows="2" class="w-full mt-0.5 px-1.5 py-1 rounded border text-xs resize-y" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" placeholder="Leave blank to use Arena default" value={$arenaSlotOverrides.A?.system_prompt ?? ''} oninput={slotOverrideInput('A', 'system_prompt')}></textarea>
          <button type="button" class="mt-1.5 text-[10px] underline opacity-80 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => setArenaSlotOverride('A', null)}>Reset to Arena default</button>
        </div>
      {/if}
      <div class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 overscroll-contain" bind:this={arenaScrollA}>
        {#if !$dashboardModelA}
          <div class="text-sm" style="color: var(--ui-text-secondary);">Select a model to start.</div>
        {:else if $arenaSlotAIsJudge && messagesA.length === 0}
          <div class="text-sm" style="color: var(--ui-text-secondary);">Run a question so B/C/D respond, then click <strong>Judgment</strong> in the bar to score them.</div>
        {:else if messagesA.length === 0}
          <div class="text-sm" style="color: var(--ui-text-secondary);">No responses yet.</div>
        {:else}
          <div class="space-y-4">
            {#each messagesA as msg (msg.id)}
              <MessageBubble message={msg} />
            {/each}
          </div>
        {/if}
      </div>
      <div class="shrink-0 flex justify-end items-center gap-1.5 px-2 py-1.5 border-t text-[11px]" style="border-color: var(--ui-border);">
        <div class="flex items-center gap-1">
          <button type="button" class="arena-panel-options-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-opacity hover:opacity-90" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);" onclick={() => optionsOpenSlot = optionsOpenSlot === 'A' ? null : 'A'} aria-label="Model A options" aria-expanded={optionsOpenSlot === 'A'} title="Model A options">⚙ <span>Options</span></button>
          {#if running.A}<span style="color: var(--ui-accent);">Running…</span>{:else if tpsA}{@const c = Number(tpsA) >= 40 ? 'var(--atom-teal)' : Number(tpsA) >= 20 ? 'var(--atom-amber)' : 'var(--atom-accent)'}<span class="font-mono px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, {c} 20%, transparent); color: {c};">{tpsA} t/s</span>{/if}
          {#if messagesA.length > 0}<button type="button" class="p-0.5 rounded opacity-50 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => { messagesA = []; }} aria-label="Clear slot A">✕</button>{/if}
        </div>
      </div>
    </div>
    {/if}

    {#if $arenaPanelCount >= 2 && !isMobile}
    <div
      class="hidden lg:block absolute top-0 bottom-0 w-2 cursor-col-resize z-10 group"
      style="left: calc({panelWidths[0] / (panelWidths.slice(0, $arenaPanelCount).reduce((a,b)=>a+b,0) || 100) * 100}% - 4px);"
      onmousedown={(e) => startResize(0, e)}
      role="presentation">
      <div class="w-px h-full mx-auto" style="background: transparent;"></div>
    </div>
    {/if}

    {#if $arenaPanelCount >= 2}
    <div class="flex flex-col min-h-0 h-full overflow-hidden rounded-lg atom-panel-wrap border" style="background-color: var(--ui-bg-main); border-color: var(--ui-border);" role="region" aria-label="Model B panel" in:fly={{ x: 200, duration: 800, easing: quintOut }}>
      <div class="shrink-0 px-2 py-1 border-b text-[11px] font-medium" style="color: var(--ui-text-secondary); border-color: var(--ui-border);">B</div>
      {#if slotErrors.B}<div class="shrink-0 px-2 py-0.5 text-[10px]" style="color: var(--ui-accent-hot);">{slotErrors.B}</div>{/if}
      {#if optionsOpenSlot === 'B'}
        <div class="shrink-0 p-2 border-b text-xs" style="border-color: var(--ui-border); background-color: var(--ui-input-bg);">
          <p class="font-medium mb-1.5" style="color: var(--ui-text-secondary);">Model B settings</p>
          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center">
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-b-temp">Temperature</label>
            <input id="arena-opt-b-temp" type="number" step="0.1" min="0" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.B?.temperature ?? effectiveForB.temperature} oninput={slotOverrideInput('B', 'temperature')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-b-max">Max tokens</label>
            <input id="arena-opt-b-max" type="number" min="1" max="100000" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.B?.max_tokens ?? effectiveForB.max_tokens} oninput={slotOverrideInput('B', 'max_tokens')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-b-top_p">Top-P</label>
            <input id="arena-opt-b-top_p" type="number" step="0.05" min="0" max="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.B?.top_p ?? effectiveForB.top_p} oninput={slotOverrideInput('B', 'top_p')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-b-top_k">Top-K</label>
            <input id="arena-opt-b-top_k" type="number" min="1" max="200" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.B?.top_k ?? effectiveForB.top_k} oninput={slotOverrideInput('B', 'top_k')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-b-rp">Repeat penalty</label>
            <input id="arena-opt-b-rp" type="number" step="0.05" min="1" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.B?.repeat_penalty ?? effectiveForB.repeat_penalty} oninput={slotOverrideInput('B', 'repeat_penalty')} />
          </div>
          <label class="block mt-1.5 text-zinc-500 dark:text-zinc-400">System prompt template</label>
          <select class="w-full mb-0.5 px-1.5 py-0.5 rounded border text-xs" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" onchange={(e) => { const opt = ARENA_SYSTEM_PROMPT_TEMPLATES.find((t) => t.name === e.currentTarget?.value); if (opt?.prompt) applySystemPromptTemplate('B', opt.prompt); }} aria-label="System prompt template">
            {#each ARENA_SYSTEM_PROMPT_TEMPLATES as t}<option value={t.name}>{t.name}</option>{/each}
          </select>
          <label class="block mt-1 text-zinc-500 dark:text-zinc-400" for="arena-opt-b-sys">System prompt (optional)</label>
          <textarea id="arena-opt-b-sys" rows="2" class="w-full mt-0.5 px-1.5 py-1 rounded border text-xs resize-y" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" placeholder="Leave blank to use Arena default" value={$arenaSlotOverrides.B?.system_prompt ?? ''} oninput={slotOverrideInput('B', 'system_prompt')}></textarea>
          <button type="button" class="mt-1.5 text-[10px] underline opacity-80 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => setArenaSlotOverride('B', null)}>Reset to Arena default</button>
        </div>
      {/if}
      <div class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 overscroll-contain" bind:this={arenaScrollB}>
        {#if !$dashboardModelB}
          <div class="text-sm" style="color: var(--ui-text-secondary);">Select a model to start.</div>
        {:else if messagesB.length === 0}
          <div class="text-sm" style="color: var(--ui-text-secondary);">No responses yet.</div>
        {:else}
          <div class="space-y-4">
            {#each messagesB as msg (msg.id)}
              <MessageBubble message={msg} />
            {/each}
          </div>
        {/if}
      </div>
      <div class="shrink-0 flex justify-between items-center gap-2 px-2 py-1.5 border-t text-[11px]" style="border-color: var(--ui-border);">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-semibold tabular-nums shrink-0" style="color: #10b981;">{arenaScores.B} pts</span>
          <span class="text-[10px] font-medium uppercase tracking-wide opacity-90" style="color: var(--ui-text-secondary);">{arenaStandingLabel('B', arenaScores)}</span>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" class="arena-panel-options-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-opacity hover:opacity-90" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);" onclick={() => optionsOpenSlot = optionsOpenSlot === 'B' ? null : 'B'} aria-label="Model B options" aria-expanded={optionsOpenSlot === 'B'} title="Model B options">⚙ <span>Options</span></button>
          {#if running.B}<span style="color: var(--ui-accent);">Running…</span>{:else if tpsB}{@const c = Number(tpsB) >= 40 ? 'var(--atom-teal)' : Number(tpsB) >= 20 ? 'var(--atom-amber)' : 'var(--atom-accent)'}<span class="font-mono px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, {c} 20%, transparent); color: {c};">{tpsB} t/s</span>{/if}
          {#if messagesB.length > 0}<button type="button" class="p-0.5 rounded opacity-50 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => { messagesB = []; }} aria-label="Clear slot B">✕</button>{/if}
        </div>
      </div>
    </div>
    {/if}

    {#if $arenaPanelCount >= 3 && !isMobile}
    <div
      class="hidden lg:block absolute top-0 bottom-0 w-2 cursor-col-resize z-10 group"
      style="left: calc({(panelWidths[0] + panelWidths[1]) / (panelWidths.slice(0, $arenaPanelCount).reduce((a,b)=>a+b,0) || 100) * 100}% - 4px);"
      onmousedown={(e) => startResize(1, e)}
      role="presentation">
      <div class="w-px h-full mx-auto" style="background: transparent;"></div>
    </div>
    {/if}

    {#if $arenaPanelCount >= 3}
    <div class="flex flex-col min-h-0 h-full overflow-hidden rounded-lg atom-panel-wrap border" style="background-color: var(--ui-bg-main); border-color: var(--ui-border);" role="region" aria-label="Model C panel" in:fly={{ x: 200, duration: 800, easing: quintOut }}>
      <div class="shrink-0 px-2 py-1 border-b text-[11px] font-medium" style="color: var(--ui-text-secondary); border-color: var(--ui-border);">C</div>
      {#if slotErrors.C}<div class="shrink-0 px-2 py-0.5 text-[10px]" style="color: var(--ui-accent-hot);">{slotErrors.C}</div>{/if}
      {#if optionsOpenSlot === 'C'}
        <div class="shrink-0 p-2 border-b text-xs" style="border-color: var(--ui-border); background-color: var(--ui-input-bg);">
          <p class="font-medium mb-1.5" style="color: var(--ui-text-secondary);">Model C settings</p>
          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center">
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-c-temp">Temperature</label>
            <input id="arena-opt-c-temp" type="number" step="0.1" min="0" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.C?.temperature ?? effectiveForC.temperature} oninput={slotOverrideInput('C', 'temperature')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-c-max">Max tokens</label>
            <input id="arena-opt-c-max" type="number" min="1" max="100000" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.C?.max_tokens ?? effectiveForC.max_tokens} oninput={slotOverrideInput('C', 'max_tokens')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-c-top_p">Top-P</label>
            <input id="arena-opt-c-top_p" type="number" step="0.05" min="0" max="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.C?.top_p ?? effectiveForC.top_p} oninput={slotOverrideInput('C', 'top_p')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-c-top_k">Top-K</label>
            <input id="arena-opt-c-top_k" type="number" min="1" max="200" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.C?.top_k ?? effectiveForC.top_k} oninput={slotOverrideInput('C', 'top_k')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-c-rp">Repeat penalty</label>
            <input id="arena-opt-c-rp" type="number" step="0.05" min="1" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.C?.repeat_penalty ?? effectiveForC.repeat_penalty} oninput={slotOverrideInput('C', 'repeat_penalty')} />
          </div>
          <label class="block mt-1.5 text-zinc-500 dark:text-zinc-400">System prompt template</label>
          <select class="w-full mb-0.5 px-1.5 py-0.5 rounded border text-xs" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" onchange={(e) => { const opt = ARENA_SYSTEM_PROMPT_TEMPLATES.find((t) => t.name === e.currentTarget?.value); if (opt?.prompt) applySystemPromptTemplate('C', opt.prompt); }} aria-label="System prompt template">
            {#each ARENA_SYSTEM_PROMPT_TEMPLATES as t}<option value={t.name}>{t.name}</option>{/each}
          </select>
          <label class="block mt-1 text-zinc-500 dark:text-zinc-400" for="arena-opt-c-sys">System prompt (optional)</label>
          <textarea id="arena-opt-c-sys" rows="2" class="w-full mt-0.5 px-1.5 py-1 rounded border text-xs resize-y" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" placeholder="Leave blank to use Arena default" value={$arenaSlotOverrides.C?.system_prompt ?? ''} oninput={slotOverrideInput('C', 'system_prompt')}></textarea>
          <button type="button" class="mt-1.5 text-[10px] underline opacity-80 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => setArenaSlotOverride('C', null)}>Reset to Arena default</button>
        </div>
      {/if}
      <div class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 overscroll-contain" bind:this={arenaScrollC}>
        {#if !$dashboardModelC}
          <div class="text-sm" style="color: var(--ui-text-secondary);">Select a model to start.</div>
        {:else if messagesC.length === 0}
          <div class="text-sm" style="color: var(--ui-text-secondary);">No responses yet.</div>
        {:else}
          <div class="space-y-4">
            {#each messagesC as msg (msg.id)}
              <MessageBubble message={msg} />
            {/each}
          </div>
        {/if}
      </div>
      <div class="shrink-0 flex justify-between items-center gap-2 px-2 py-1.5 border-t text-[11px]" style="border-color: var(--ui-border);">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-semibold tabular-nums shrink-0" style="color: #f59e0b;">{arenaScores.C} pts</span>
          <span class="text-[10px] font-medium uppercase tracking-wide opacity-90" style="color: var(--ui-text-secondary);">{arenaStandingLabel('C', arenaScores)}</span>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" class="arena-panel-options-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-opacity hover:opacity-90" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);" onclick={() => optionsOpenSlot = optionsOpenSlot === 'C' ? null : 'C'} aria-label="Model C options" aria-expanded={optionsOpenSlot === 'C'} title="Model C options">⚙ <span>Options</span></button>
          {#if running.C}<span style="color: var(--ui-accent);">Running…</span>{:else if tpsC}{@const c = Number(tpsC) >= 40 ? 'var(--atom-teal)' : Number(tpsC) >= 20 ? 'var(--atom-amber)' : 'var(--atom-accent)'}<span class="font-mono px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, {c} 20%, transparent); color: {c};">{tpsC} t/s</span>{/if}
          {#if messagesC.length > 0}<button type="button" class="p-0.5 rounded opacity-50 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => { messagesC = []; }} aria-label="Clear slot C">✕</button>{/if}
        </div>
      </div>
    </div>
    {/if}

    {#if $arenaPanelCount >= 4 && !isMobile}
    <div
      class="hidden lg:block absolute top-0 bottom-0 w-2 cursor-col-resize z-10 group"
      style="left: calc({(panelWidths[0] + panelWidths[1] + panelWidths[2]) / (panelWidths.slice(0, $arenaPanelCount).reduce((a,b)=>a+b,0) || 100) * 100}% - 4px);"
      onmousedown={(e) => startResize(2, e)}
      role="presentation">
      <div class="w-px h-full mx-auto" style="background: transparent;"></div>
    </div>
    {/if}

    {#if $arenaPanelCount >= 4}
    <div class="flex flex-col min-h-0 h-full overflow-hidden rounded-lg atom-panel-wrap border" style="background-color: var(--ui-bg-main); border-color: var(--ui-border);" role="region" aria-label="Model D panel" in:fly={{ x: 200, duration: 800, easing: quintOut }}>
      <div class="shrink-0 px-2 py-1 border-b text-[11px] font-medium" style="color: var(--ui-text-secondary); border-color: var(--ui-border);">D</div>
      {#if slotErrors.D}<div class="shrink-0 px-2 py-0.5 text-[10px]" style="color: var(--ui-accent-hot);">{slotErrors.D}</div>{/if}
      {#if optionsOpenSlot === 'D'}
        <div class="shrink-0 p-2 border-b text-xs" style="border-color: var(--ui-border); background-color: var(--ui-input-bg);">
          <p class="font-medium mb-1.5" style="color: var(--ui-text-secondary);">Model D settings</p>
          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center">
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-d-temp">Temperature</label>
            <input id="arena-opt-d-temp" type="number" step="0.1" min="0" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.D?.temperature ?? effectiveForD.temperature} oninput={slotOverrideInput('D', 'temperature')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-d-max">Max tokens</label>
            <input id="arena-opt-d-max" type="number" min="1" max="100000" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.D?.max_tokens ?? effectiveForD.max_tokens} oninput={slotOverrideInput('D', 'max_tokens')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-d-top_p">Top-P</label>
            <input id="arena-opt-d-top_p" type="number" step="0.05" min="0" max="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.D?.top_p ?? effectiveForD.top_p} oninput={slotOverrideInput('D', 'top_p')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-d-top_k">Top-K</label>
            <input id="arena-opt-d-top_k" type="number" min="1" max="200" step="1" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.D?.top_k ?? effectiveForD.top_k} oninput={slotOverrideInput('D', 'top_k')} />
            <label class="text-zinc-500 dark:text-zinc-400" for="arena-opt-d-rp">Repeat penalty</label>
            <input id="arena-opt-d-rp" type="number" step="0.05" min="1" max="2" class="w-20 px-1.5 py-0.5 rounded border text-right font-mono" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" value={$arenaSlotOverrides.D?.repeat_penalty ?? effectiveForD.repeat_penalty} oninput={slotOverrideInput('D', 'repeat_penalty')} />
          </div>
          <label class="block mt-1.5 text-zinc-500 dark:text-zinc-400">System prompt template</label>
          <select class="w-full mb-0.5 px-1.5 py-0.5 rounded border text-xs" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" onchange={(e) => { const opt = ARENA_SYSTEM_PROMPT_TEMPLATES.find((t) => t.name === e.currentTarget?.value); if (opt?.prompt) applySystemPromptTemplate('D', opt.prompt); }} aria-label="System prompt template">
            {#each ARENA_SYSTEM_PROMPT_TEMPLATES as t}<option value={t.name}>{t.name}</option>{/each}
          </select>
          <label class="block mt-1 text-zinc-500 dark:text-zinc-400" for="arena-opt-d-sys">System prompt (optional)</label>
          <textarea id="arena-opt-d-sys" rows="2" class="w-full mt-0.5 px-1.5 py-1 rounded border text-xs resize-y" style="border-color: var(--ui-border); background-color: var(--ui-bg-main); color: var(--ui-text-primary);" placeholder="Leave blank to use Arena default" value={$arenaSlotOverrides.D?.system_prompt ?? ''} oninput={slotOverrideInput('D', 'system_prompt')}></textarea>
          <button type="button" class="mt-1.5 text-[10px] underline opacity-80 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => setArenaSlotOverride('D', null)}>Reset to Arena default</button>
        </div>
      {/if}
      <div class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 overscroll-contain" bind:this={arenaScrollD}>
        {#if !$dashboardModelD}
          <div class="text-sm" style="color: var(--ui-text-secondary);">Select a model to start.</div>
        {:else if messagesD.length === 0}
          <div class="text-sm" style="color: var(--ui-text-secondary);">No responses yet.</div>
        {:else}
          <div class="space-y-4">
            {#each messagesD as msg (msg.id)}
              <MessageBubble message={msg} />
            {/each}
          </div>
        {/if}
      </div>
      <div class="shrink-0 flex justify-between items-center gap-2 px-2 py-1.5 border-t text-[11px]" style="border-color: var(--ui-border);">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-semibold tabular-nums shrink-0" style="color: #8b5cf6;">{arenaScores.D} pts</span>
          <span class="text-[10px] font-medium uppercase tracking-wide opacity-90" style="color: var(--ui-text-secondary);">{arenaStandingLabel('D', arenaScores)}</span>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" class="arena-panel-options-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-opacity hover:opacity-90" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);" onclick={() => optionsOpenSlot = optionsOpenSlot === 'D' ? null : 'D'} aria-label="Model D options" aria-expanded={optionsOpenSlot === 'D'} title="Model D options">⚙ <span>Options</span></button>
          {#if running.D}<span style="color: var(--ui-accent);">Running…</span>{:else if tpsD}{@const c = Number(tpsD) >= 40 ? 'var(--atom-teal)' : Number(tpsD) >= 20 ? 'var(--atom-amber)' : 'var(--atom-accent)'}<span class="font-mono px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, {c} 20%, transparent); color: {c};">{tpsD} t/s</span>{/if}
          {#if messagesD.length > 0}<button type="button" class="p-0.5 rounded opacity-50 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => { messagesD = []; }} aria-label="Clear slot D">✕</button>{/if}
        </div>
      </div>
    </div>
    {/if}
  </div>

  {#if arenaTransitionPhase}
    <div class="shrink-0 flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-lg mx-2 mb-1 border" style="background-color: var(--ui-input-bg); border-color: var(--ui-border); color: var(--ui-text-primary);" role="status" aria-live="polite">
      <div class="flex items-center gap-2">
        <ThinkingAtom size={22} />
        <span class="text-sm font-medium">
          {#if arenaTransitionPhase === 'judge_web'}
            {JUDGE_WEB_LINES[judgeWebMessageIndex].main}
          {:else if arenaTransitionPhase === 'ejecting'}
            Ejecting…
          {:else}
            New model loading
          {/if}
        </span>
      </div>
      {#if arenaTransitionPhase === 'judge_web'}
        <span class="text-xs opacity-80" style="color: var(--ui-text-secondary);">{JUDGE_WEB_LINES[judgeWebMessageIndex].sub}</span>
      {/if}
    </div>
  {/if}

  <!-- Minimal footer: chat error + send -->
  <div class="shrink-0 border-t px-3 py-2" style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);">
    {#if $chatError}
      <div class="mb-2 px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2" style="background: rgba(239,68,68,0.1); color: var(--ui-accent-hot); border: 1px solid var(--ui-border);" role="alert">
        <span>{$chatError}</span>
        <button type="button" class="shrink-0 p-1 rounded hover:opacity-80" onclick={() => chatError.set(null)} aria-label="Dismiss">×</button>
      </div>
    {/if}
    <section class="max-w-2xl mx-auto w-full" aria-label="Send prompt">
      <ChatInput onSend={sendUserMessage} onStop={stopAll} />
    </section>
  </div>

  <!-- Floating question panel removed: question now shows cleanly in each slot's chat bubble -->

  <!-- Draggable floating panel: Ask the Judge (only when slot A is judge) -->
  {#if $arenaSlotAIsJudge}
    <div
      class="arena-floating-panel rounded-lg border shadow-lg overflow-hidden"
      style="position: fixed; left: {askJudgePanelPos.x}px; top: {askJudgePanelPos.y}px; z-index: 30; width: min(380px, calc(100vw - 2rem)); background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);">
      <div
        class="arena-floating-handle flex items-center justify-between gap-2 px-3 py-2 cursor-grab active:cursor-grabbing select-none"
        style="border-bottom: 1px solid var(--ui-border); color: var(--ui-text-primary);"
        use:makeDraggable={{
          storageKey: 'arenaAskJudgePanelPos',
          getPos: () => askJudgePanelPos,
          setPos: (p) => askJudgePanelPos = p
        }}
      >
        <span class="text-xs font-semibold">🧑‍⚖️ Ask the Judge</span>
        {#if askJudgeExpanded}
          <button type="button" class="p-1 rounded opacity-70 hover:opacity-100" style="color: var(--ui-text-secondary);" onclick={() => askJudgeExpanded = false} aria-label="Collapse">×</button>
        {:else}
          <button type="button" class="text-xs font-medium px-2 py-1 rounded" style="background: var(--ui-accent); color: var(--ui-bg-main);" onclick={() => askJudgeExpanded = true} aria-label="Expand">Open</button>
        {/if}
      </div>
      {#if askJudgeExpanded}
        {#if askJudgeReply}
          <div class="px-3 py-2 text-xs leading-relaxed border-b max-h-48 overflow-y-auto" style="background-color: var(--ui-input-bg); border-color: var(--ui-border); color: var(--ui-text-primary); white-space: pre-wrap;">
            {askJudgeReply}
          </div>
        {/if}
        <div class="flex gap-1.5 p-2">
          <textarea
            id="arena-ask-judge"
            class="flex-1 px-2.5 py-2 text-xs resize-none rounded-md"
            style="background-color: var(--ui-input-bg); color: var(--ui-text-primary); border: 1px solid var(--ui-border);"
            placeholder="e.g. Why did you give Model B a 6 instead of a 4?"
            rows="2"
            bind:value={askJudgeQuestion}
            onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askTheJudge(); } }}
          ></textarea>
          <button
            type="button"
            class="self-end shrink-0 h-8 px-3 rounded-md text-xs font-semibold transition-opacity disabled:opacity-40"
            style="background-color: var(--ui-accent); color: var(--ui-bg-main);"
            disabled={askJudgeLoading || !askJudgeQuestion.trim()}
            onclick={askTheJudge}
          >
            {#if askJudgeLoading}
              Thinking…
            {:else}
              Ask
            {/if}
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- === Arena settings: slide-out from right (Questions, Answer key, Contest rules, Execution, Web search, Actions) === -->
  {#if arenaSettingsOpen}
    <div
      class="fixed inset-0 z-[200] transition-opacity duration-300"
      role="dialog"
      aria-modal="true"
      aria-label="Arena settings">
      <div
        class="absolute inset-0 bg-black/30"
        role="button"
        tabindex="-1"
        aria-label="Close settings"
        onclick={() => arenaSettingsOpen = false}
        onkeydown={(e) => e.key === 'Escape' && (arenaSettingsOpen = false)}
      ></div>
      <div
        class="absolute top-0 right-0 bottom-0 w-[320px] flex flex-col border-l shadow-xl transition-transform duration-300"
        style="background-color: var(--ui-bg-main); border-color: var(--ui-border);">
        <div class="shrink-0 flex items-center justify-between px-4 py-4 border-b" style="border-color: var(--ui-border);">
          <h2 class="text-base font-semibold" style="color: var(--ui-text-primary);">Arena settings</h2>
          <button type="button" class="p-2 rounded-lg hover:opacity-80" style="color: var(--ui-text-secondary);" onclick={() => arenaSettingsOpen = false} aria-label="Close">×</button>
        </div>
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          <!-- 1. Questions & answers (one block: optional Answer: per question) -->
          <section>
            <h3 class="font-semibold text-sm mb-1" style="color: var(--ui-text-primary);">Questions & answers</h3>
            <p class="text-xs mb-3" style="color: var(--ui-text-secondary);">Paste questions and optional answers in one place. Number each question (1. … 2. …). Add a line <strong>Answer: …</strong> under a question to give the judge that answer for scoring. If you omit Answer: for a question, the judge uses web (if on) or its own knowledge.</p>
            <textarea
              id="arena-questions-and-answers-settings"
              class="w-full rounded-md resize-y text-[13px] font-sans"
              style="padding: 12px; background-color: var(--ui-input-bg); border: 1px solid var(--ui-border); color: var(--ui-text-primary); min-height: 220px;"
              placeholder="1. What is the primary function of a differential?
Answer: To allow the drive wheels to rotate at different speeds (e.g. when turning).

2. Who built the first practical steam engine?
Answer: Thomas Newcomen.

3. Question with no answer (judge uses web or own knowledge)"
              rows="12"
              bind:value={questionsAndAnswers}
            ></textarea>
            {#if parsedQuestions.length > 0}
              {@const withAnswers = parsedAnswers.filter((a) => (a || '').trim().length > 0).length}
              <p class="text-[11px] mt-1.5 font-medium" style="color: var(--ui-accent);">{parsedQuestions.length} question{parsedQuestions.length === 1 ? '' : 's'} loaded · {withAnswers} with answers</p>
            {/if}
          </section>
          <!-- 2. Judge instructions (custom rubric) -->
          <section>
            <h3 class="font-semibold text-sm mb-1" style="color: var(--ui-text-primary);">Judge instructions</h3>
            <p class="text-xs mb-2" style="color: var(--ui-text-secondary);">Custom rubric or scoring instructions for the judge. Replaces the default "Score 1-10" preamble. Leave blank for default.</p>
            <textarea
              id="arena-judge-instructions-settings"
              class="w-full rounded-md resize-y text-[13px] font-sans"
              style="padding: 10px; background-color: var(--ui-input-bg); border: 1px solid var(--ui-border); color: var(--ui-text-primary); min-height: 70px;"
              placeholder="e.g. You are a judge. Score each model 1-10. Weight accuracy 60%, conciseness 20%, formatting 20%. Penalize factual errors heavily."
              rows="3"
              bind:value={judgeInstructions}
            ></textarea>
          </section>
          <!-- 3. Judge feedback / correction -->
          <section>
            <h3 class="font-semibold text-sm mb-1" style="color: var(--ui-text-primary);">Judge feedback / correction</h3>
            <p class="text-xs mb-2" style="color: var(--ui-text-secondary);">Optional correction or rubric hint sent to the judge when scoring. Use this to steer scoring (e.g. "NFPA 72 requires X, not Y" or "weight conciseness higher"). Leave blank for default scoring.</p>
            <textarea
              id="arena-judge-feedback-settings"
              class="w-full rounded-md resize-y text-[13px] font-sans"
              style="padding: 10px; background-color: var(--ui-input-bg); border: 1px solid var(--ui-border); color: var(--ui-text-primary); min-height: 70px;"
              placeholder="e.g. The correct answer to Q3 is actually 42, not 37. Weight accuracy over style."
              rows="3"
              bind:value={judgeFeedback}
            ></textarea>
          </section>
          <!-- 3. Contest rules (accordion, collapsed by default) -->
          <section>
            <button
              type="button"
              class="w-full flex items-center justify-between text-left font-semibold text-sm mb-3"
              style="color: var(--ui-text-primary);"
              onclick={() => settingsRulesExpanded = !settingsRulesExpanded}
              aria-expanded={settingsRulesExpanded}>
              Contest rules
              <span aria-hidden="true">{settingsRulesExpanded ? '▼' : '▶'}</span>
            </button>
            {#if settingsRulesExpanded}
              <textarea
                id="arena-contest-rules-settings"
                class="w-full px-3 py-2 rounded-lg border text-xs resize-y max-h-[200px]"
                style="border-color: var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);"
                placeholder="Paste contest rules. Sent with every question."
                rows="4"
                bind:value={contestRules}
              ></textarea>
            {/if}
          </section>
          <!-- Execution mode -->
          <section>
            <h3 class="font-semibold text-sm mb-3" style="color: var(--ui-text-primary);">Execution mode</h3>
            <label class="flex items-start gap-2 cursor-pointer text-sm" style="color: var(--ui-text-secondary);">
              <input type="checkbox" bind:checked={sequential} class="rounded mt-0.5" style="accent-color: var(--ui-accent);" onchange={() => { if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume); }} />
              <span>Sequential (one at a time). Off = parallel.</span>
            </label>
          </section>
          <!-- Web search -->
          <section>
            <h3 class="font-semibold text-sm mb-3" style="color: var(--ui-text-primary);">Web search</h3>
            <div class="flex rounded-lg border overflow-hidden" style="border-color: var(--ui-border);">
              <button type="button" class="flex-1 px-2 py-1.5 text-xs font-medium transition-colors" class:opacity-70={$arenaWebSearchMode !== 'none'} style="border-color: var(--ui-border); background: {$arenaWebSearchMode === 'none' ? 'var(--ui-sidebar-active)' : 'transparent'}; color: {$arenaWebSearchMode === 'none' ? 'var(--ui-text-primary)' : 'var(--ui-text-secondary)'}" onclick={() => { arenaWebSearchMode.set('none'); if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume); }}>None</button>
              <button type="button" class="flex-1 px-2 py-1.5 text-xs font-medium transition-colors border-l" class:opacity-70={$arenaWebSearchMode !== 'all'} style="border-color: var(--ui-border); background: {$arenaWebSearchMode === 'all' ? 'var(--ui-sidebar-active)' : 'transparent'}; color: {$arenaWebSearchMode === 'all' ? 'var(--ui-text-primary)' : 'var(--ui-text-secondary)'}" onclick={() => { arenaWebSearchMode.set('all'); if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume); }}>All</button>
              <button type="button" class="flex-1 px-2 py-1.5 text-xs font-medium transition-colors border-l" class:opacity-70={$arenaWebSearchMode !== 'judge'} style="border-color: var(--ui-border); background: {$arenaWebSearchMode === 'judge' ? 'var(--ui-sidebar-active)' : 'transparent'}; color: {$arenaWebSearchMode === 'judge' ? 'var(--ui-text-primary)' : 'var(--ui-text-secondary)'}" onclick={() => { arenaWebSearchMode.set('judge'); if ($settings.audio_enabled && $settings.audio_clicks) playClick($settings.audio_volume); }}>Judge only</button>
            </div>
          </section>
          <!-- Score breakdown -->
          <section>
            <h3 class="font-semibold text-sm mb-3" style="color: var(--ui-text-primary);">Score breakdown</h3>
            <ArenaScoreMatrix
              scoreHistory={scoreHistory}
              totals={arenaScores}
              visibleSlots={$arenaPanelCount >= 4 ? ['B', 'C', 'D'] : $arenaPanelCount >= 3 ? ['B', 'C'] : ['B']}
            />
          </section>
          <!-- Actions -->
          <section>
            <h3 class="font-semibold text-sm mb-3" style="color: var(--ui-text-primary);">Actions</h3>
            <p class="text-xs mb-2" style="color: var(--ui-text-secondary);">Reset all scores sets B/C/D back to 0 so you can start a new competition. You can also use <strong>Reset scores</strong> in the bar above.</p>
            <div class="flex flex-col gap-2">
              <button
                type="button"
                class="w-full px-3 py-2 rounded-lg text-sm font-medium border"
                style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-secondary);"
                onclick={confirmResetScores}>
                Reset all scores
              </button>
              <button
                type="button"
                class="w-full px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-secondary);"
                disabled={ejectBusy}
                onclick={confirmEjectAll}>
                {ejectBusy ? 'Ejecting…' : 'Eject all models'}
              </button>
              {#if ejectMessage}
                <span class="text-xs" style="color: var(--atom-teal);" role="status">{ejectMessage}</span>
              {/if}
            </div>
          </section>
        </div>
      </div>
    </div>
  {/if}
</div>
