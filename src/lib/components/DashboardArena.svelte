<script>
  /**
   * DashboardArena (ATOM Arena): head-to-head model comparison. All four slots (A–D) are contestants.
   * Layout: header (model cards A–D with scores) → question bar (Q selector, Ask, Next, Web, Start Over, Settings) → response panels (resizable) → footer (ChatInput).
   * When the last contestant finishes, automated scoring runs (using Slot A's model for the scoring API) and a popup shows scores + brief explanation for each model.
   * Right slide-out: Arena settings (Questions, Answer key, Contest rules, Execution, Web search, Actions).
   */
  import { get } from "svelte/store";
  import { onMount } from "svelte";
  import {
    chatError,
    dashboardModelA,
    dashboardModelB,
    dashboardModelC,
    dashboardModelD,
    isStreaming,
    settings,
    globalDefault,
    perModelOverrides,
    getEffectiveSettingsForModel,
    mergeEffectiveSettings,
    liveTokens,
    pushTokSample,
    liveTokPerSec,
    arenaPanelCount,
    arenaWebSearchMode,
    arenaScoringModelId,
    arenaBlindReview,
    arenaDeterministicJudge,
    arenaSlotOverrides,
    models,
    pendingDroppedFiles,
    webSearchForNextMessage,
    webSearchInProgress,
    webSearchConnected,
    layout,
    lmStudioUnloadHelperUrl,
    confirm,
  } from "$lib/stores.js";
  import { playClick, playComplete } from "$lib/audio.js";
  import {
    streamChatCompletion,
    unloadModel,
    loadModel,
    waitUntilUnloaded,
    unloadAllLoadedModels,
    unloadAllModelsNative,
    getLoadedModelKeys,
  } from "$lib/api.js";
  import {
    searchDuckDuckGo,
    formatSearchResultForChat,
    warmUpSearchConnection,
  } from "$lib/duckduckgo.js";
  import ChatInput from "$lib/components/ChatInput.svelte";
  import ThinkingAtom from "$lib/components/ThinkingAtom.svelte";
  import ModelSelectorSlot from "$lib/components/ModelSelectorSlot.svelte";
  import ArenaPanel from "$lib/components/ArenaPanel.svelte";
  import ArenaScoreMatrix from "$lib/components/ArenaScoreMatrix.svelte";
  import ArenaHeader from "$lib/components/ArenaHeader.svelte";
  import ArenaControlBar from "$lib/components/ArenaControlBar.svelte";
  import {
    generateId,
    resizeImageDataUrlsForVision,
    shouldSkipImageResizeForVision,
  } from "$lib/utils.js";
  import {
    parseQuestionsAndAnswers,
    parseJudgeScores,
    parseJudgeScoresAndExplanations,
    parseBlindJudgeScores,
    buildJudgePrompt,
    buildJudgePromptBlind,
    makeSeededRandom,
    pickJudgeModel,
    sanitizeContestantResponse,
    ARENA_CONTESTANT_SYSTEM_PROMPT,
    JUDGE_LOADING_LINES,
    detectLoop,
    contentToText,
    JUDGE_WEB_LINES,
    arenaStandingLabel,
    loadScoreHistory,
    addScoreRound,
    computeTotals,
    clearScoreHistory,
    migrateOldQuestionsAndAnswers,
  } from "$lib/arenaLogic.js";

  // ---------- State ----------
  let messagesA = $state([]);
  let messagesB = $state([]);
  let messagesC = $state([]);
  let messagesD = $state([]);
  let running = $state({ A: false, B: false, C: false, D: false });
  let slotErrors = $state({ A: "", B: "", C: "", D: "" });
  /** Optional feedback/correction sent to the judge (e.g. correct NFPA 72 definition). */
  let judgeFeedback = $state("");
  /** Arena footer: Questions list expanded vs collapsed. */
  let arenaSetupExpanded = $state(
    typeof localStorage !== "undefined"
      ? (localStorage.getItem("arenaSetupExpanded") ?? "1") !== "0"
      : true,
  );
  $effect(() => {
    if (typeof localStorage !== "undefined" && arenaSetupExpanded !== undefined)
      localStorage.setItem(
        "arenaSetupExpanded",
        arenaSetupExpanded ? "1" : "0",
      );
  });
  /** Contest rules: persistent, sent with each question. Stored in localStorage. */
  let contestRules = $state(
    typeof localStorage !== "undefined"
      ? (localStorage.getItem("arenaContestRules") ?? "")
      : "",
  );
  $effect(() => {
    if (typeof localStorage !== "undefined" && contestRules !== undefined)
      localStorage.setItem("arenaContestRules", contestRules);
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
    if (typeof localStorage === "undefined") return "";
    const next = localStorage.getItem("arenaQuestionsAndAnswers");
    if (next != null && next !== "") return next;
    const oldQ = localStorage.getItem("arenaQuestionsList") ?? "";
    const oldA = localStorage.getItem("arenaAnswerKey") ?? "";
    if (oldQ.trim() === "" && oldA.trim() === "") return "";
    if (oldQ.trim() === "") return "";
    return migrateOldQuestionsAndAnswers(oldQ, oldA);
  }
  let questionsAndAnswers = $state(loadQuestionsAndAnswers());
  let questionIndex = $state(0);
  $effect(() => {
    if (
      typeof localStorage !== "undefined" &&
      questionsAndAnswers !== undefined
    )
      localStorage.setItem("arenaQuestionsAndAnswers", questionsAndAnswers);
  });

  const { questions: parsedQuestions, answers: parsedAnswers } = $derived(
    parseQuestionsAndAnswers(questionsAndAnswers),
  );
  /** Answer for the current question only (blank if none provided → judge uses web or own knowledge). */
  const currentQuestionAnswer = $derived(
    parsedQuestions.length > 0 && parsedAnswers.length > 0
      ? (parsedAnswers[questionIndex % parsedQuestions.length] || "").trim()
      : "",
  );
  const currentQuestionNum = $derived(
    parsedQuestions.length > 0
      ? (questionIndex % parsedQuestions.length) + 1
      : 0,
  );
  const currentQuestionTotal = $derived(parsedQuestions.length);
  const currentQuestionText = $derived(
    parsedQuestions.length > 0
      ? (parsedQuestions[questionIndex % parsedQuestions.length] || "").trim()
      : "",
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
    if (!on) {
      arenaWebWarmUpAttempted = false;
      return;
    }
    if (connected || arenaWebWarmingUp || arenaWebWarmUpAttempted) return;
    runArenaWarmUp();
  });

  /** Accordion open state in settings panel. */
  let settingsRulesExpanded = $state(false);
  /** Ask the Judge: collapsible panel bottom-left; default collapsed. */
  let askJudgeExpanded = $state(false);
  let askJudgeQuestion = $state("");
  let askJudgeReply = $state("");
  let askJudgeLoading = $state(false);
  let runId = 0;
  let lastSampleAt = 0;
  let lastSampleTokens = 0;
  /** Which Arena slot's "Model options" panel is open: 'A'|'B'|'C'|'D'|null */
  let optionsOpenSlot = $state(null);
  /** When set, show modal with automated judgment scores and explanation. */
  let judgmentPopup = $state(
    /** @type {null | { scores: Record<string, number>, explanation: string, rawJudgeOutput?: string, questionIndex?: number, explanations?: Record<string, string> }} */ (null),
  );
  /** Transition: 'ejecting' | 'loading' | 'loading_judge' | 'judge_web' | 'scoring' (atom animation). */
  let arenaTransitionPhase = $state(
    /** @type {null | 'ejecting' | 'loading' | 'loading_judge' | 'judge_web' | 'scoring'} */ (null),
  );
  /** Index of the current witty "judge checking web" message (rotated each time we enter judge_web). */
  let judgeWebMessageIndex = $state(0);
  /** Index of the current witty "judge loading" message (rotated each time judge is loaded). */
  let judgeLoadingMessageIndex = $state(0);
  /** Current run metadata for reproducibility and logging (set at run start, filled during run, read in runJudgment). */
  let arenaCurrentRunMeta = $state(/** @type {null | { run_id: string, seed: string, question_index: number, prompt_text: string, model_list: Array<{ slot: string, model_id: string }>, judge_model: string | null, deterministic_judge: boolean, blind_review: boolean, start_timestamp: number, responses: Record<string, { model_id: string, prompt: string, raw_response: string, latency_ms: number, token_count: number | null, timestamp: number }> }} */ (null));

  // ---------- Arena slot configuration ----------
  const SLOT_COLORS = {
    A: "#3b82f6",
    B: "#10b981",
    C: "#f59e0b",
    D: "#8b5cf6",
  };
  const SLOTS = ["A", "B", "C", "D"];

  // ---------- Score history (per-question breakdown) ----------
  let scoreHistory = $state(loadScoreHistory());
  const scoreTotals = $derived(computeTotals(scoreHistory));

  // ---------- Judge instructions (custom rubric) ----------
  let judgeInstructions = $state(
    typeof localStorage !== "undefined"
      ? (localStorage.getItem("arenaJudgeInstructions") ?? "")
      : "",
  );
  $effect(() => {
    if (typeof localStorage !== "undefined" && judgeInstructions !== undefined)
      localStorage.setItem("arenaJudgeInstructions", judgeInstructions);
  });

  // ---------- Run All automation ----------
  let runAllActive = $state(false);
  let runAllProgress = $state({ current: 0, total: 0 });

  // ---------- Arena message persistence (survive refresh) ----------
  function saveArenaMessages() {
    if (typeof sessionStorage === "undefined") return;
    try {
      sessionStorage.setItem("arenaMessagesA", JSON.stringify(messagesA));
      sessionStorage.setItem("arenaMessagesB", JSON.stringify(messagesB));
      sessionStorage.setItem("arenaMessagesC", JSON.stringify(messagesC));
      sessionStorage.setItem("arenaMessagesD", JSON.stringify(messagesD));
    } catch (_) {
      /* sessionStorage full or unavailable */
    }
  }
  function loadArenaMessages() {
    if (typeof sessionStorage === "undefined") return;
    try {
      const a = sessionStorage.getItem("arenaMessagesA");
      const b = sessionStorage.getItem("arenaMessagesB");
      const c = sessionStorage.getItem("arenaMessagesC");
      const d = sessionStorage.getItem("arenaMessagesD");
      if (a) messagesA = JSON.parse(a);
      if (b) messagesB = JSON.parse(b);
      if (c) messagesC = JSON.parse(c);
      if (d) messagesD = JSON.parse(d);
    } catch (_) {}
  }
  // Load persisted messages on mount; eject any loaded models so Arena starts clean.
  onMount(() => {
    loadArenaMessages();
    // Eject all loaded models on Arena open so we start with zero models in VRAM.
    (async () => {
      try {
        await unloadAllModelsNative();
        // Also wait for confirmation they're gone
        const loaded = await getLoadedModelKeys();
        if (loaded.length > 0) {
          // Still loaded — poll until empty or timeout
          await waitUntilUnloaded(loaded, { pollIntervalMs: 500, timeoutMs: 15000 });
        }
      } catch (_) {
        /* best-effort; don't block UI */
      }
    })();
  });
  // Save whenever messages change
  $effect(() => {
    messagesA;
    messagesB;
    messagesC;
    messagesD;
    saveArenaMessages();
  });

  const _REMOVED_JUDGE_WEB_LINES = [
    // eslint-disable-line no-unused-vars -- imported from arenaLogic.js now; kept to avoid git churn on smart-quoted strings
    {
      main: "Judge is checking the web…",
      sub: "(Googling so the judge can fact-check. No, really.)",
    },
    {
      main: "Judge is checking the internet.",
      sub: "(Yes, the whole thing. We asked nicely.)",
    },
    {
      main: "Judge is consulting the oracle.",
      sub: "(It’s Google. But “oracle” sounds cooler.)",
    },
    {
      main: "Judge is fact-checking in the cloud.",
      sub: "(Someone had to. It’s not gonna check itself.)",
    },
    {
      main: "Judge is asking the internet.",
      sub: "(We’ll see if it answers. Usually it’s cats.)",
    },
    {
      main: "Judge is doing the research.",
      sub: "(So you don’t have to. You’re welcome.)",
    },
    {
      main: "Judge is verifying things.",
      sub: "(Rumors say the internet has facts. We’re testing that.)",
    },
    {
      main: "Judge is hitting the books.",
      sub: "(The books are web servers. Same energy.)",
    },
    {
      main: "Judge is checking the web…",
      sub: "(Making sure the models didn’t just make it up. Again.)",
    },
  ];

  // ---------- Draggable floating panels (question + Ask the Judge) ----------
  function loadPanelPos(key, defaultX, defaultY) {
    if (typeof localStorage === "undefined")
      return { x: defaultX, y: defaultY };
    try {
      const s = localStorage.getItem(key);
      if (!s) return { x: defaultX, y: defaultY };
      const { x, y } = JSON.parse(s);
      if (typeof x === "number" && typeof y === "number") return { x, y };
    } catch (_) {}
    return { x: defaultX, y: defaultY };
  }
  let askJudgePanelPos = $state(loadPanelPos("arenaAskJudgePanelPos", 16, 300));

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
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      const pos = getPos();
      const rect = panelEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.max(0, Math.min(vw - rect.width, pos.x));
      const y = Math.max(0, Math.min(vh - rect.height, pos.y));
      setPos({ x, y });
      if (typeof localStorage !== "undefined")
        localStorage.setItem(storageKey, JSON.stringify({ x, y }));
    }
    let startX, startY, startLeft, startTop;
    function down(e) {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest("button")) return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      const p = getPos();
      startLeft = p.x;
      startTop = p.y;
      dragging = true;
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    }
    handleEl.addEventListener("pointerdown", down);
    return {
      destroy() {
        handleEl.removeEventListener("pointerdown", down);
        // Always clean up document listeners on destroy (prevents leaks if destroyed mid-drag)
        if (dragging) {
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
        }
      },
    };
  }

  /** Eject-all in progress; message after (success or error). */
  let ejectBusy = $state(false);
  let ejectMessage = $state(/** @type {null | string} */ (null));

  /** Running scores for all four slots (A–D). Persisted to localStorage. */
  const loadArenaScores = () => {
    if (typeof localStorage === "undefined") return { A: 0, B: 0, C: 0, D: 0 };
    try {
      const raw = localStorage.getItem("arenaScores");
      if (!raw) return { A: 0, B: 0, C: 0, D: 0 };
      const o = JSON.parse(raw);
      return {
        A: Number(o.A) || 0,
        B: Number(o.B) || 0,
        C: Number(o.C) || 0,
        D: Number(o.D) || 0,
      };
    } catch {
      return { A: 0, B: 0, C: 0, D: 0 };
    }
  };
  let arenaScores = $state(loadArenaScores());
  $effect(() => {
    if (typeof localStorage !== "undefined" && arenaScores)
      localStorage.setItem("arenaScores", JSON.stringify(arenaScores));
  });

  // ---------- Abort controllers (per-slot stream cancel) ----------
  const aborters = { A: null, B: null, C: null, D: null };

  const effectiveForA = $derived(
    mergeEffectiveSettings(
      $dashboardModelA || "",
      $globalDefault,
      $perModelOverrides,
    ),
  );
  const effectiveForB = $derived(
    mergeEffectiveSettings(
      $dashboardModelB || "",
      $globalDefault,
      $perModelOverrides,
    ),
  );
  const effectiveForC = $derived(
    mergeEffectiveSettings(
      $dashboardModelC || "",
      $globalDefault,
      $perModelOverrides,
    ),
  );
  const effectiveForD = $derived(
    mergeEffectiveSettings(
      $dashboardModelD || "",
      $globalDefault,
      $perModelOverrides,
    ),
  );

  // ---------- Lifecycle ----------
  onMount(() => {
    function onKeydown(e) {
      if (get(layout) !== "arena") return;
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n =
        e.key === "1"
          ? 1
          : e.key === "2"
            ? 2
            : e.key === "3"
              ? 3
              : e.key === "4"
                ? 4
                : null;
      if (n != null) {
        e.preventDefault();
        arenaPanelCount.set(n);
      }
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  });

  // ---------- Judge / scores ----------

  function resetArenaScores() {
    arenaScores = { A: 0, B: 0, C: 0, D: 0 };
    scoreHistory = [];
    clearScoreHistory();
  }

  /** Full arena reset: clear all messages, scores, history, errors, go back to Q1. */
  async function startOver() {
    const ok = await confirm({
      title: "Start over",
      message:
        "Clear all model responses, reset all scores, and go back to question 1. This cannot be undone.",
      confirmLabel: "Start over",
      cancelLabel: "Cancel",
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
    arenaScores = { A: 0, B: 0, C: 0, D: 0 };
    scoreHistory = [];
    clearScoreHistory();
    // Reset to Q1
    questionIndex = 0;
    // Clear errors
    chatError.set(null);
    slotErrors = { A: "", B: "", C: "", D: "" };
    // Clear persisted messages
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("arenaMessagesA");
      sessionStorage.removeItem("arenaMessagesB");
      sessionStorage.removeItem("arenaMessagesC");
      sessionStorage.removeItem("arenaMessagesD");
    }
    // Clear ask the judge state
    askJudgeReply = "";
    askJudgeQuestion = "";
    // Clear Run All state
    runAllActive = false;
    runAllProgress = { current: 0, total: 0 };
  }

  // ---------- Message helpers (get/set/push/update per slot) ----------
  function getMessages(slot) {
    return slot === "A"
      ? messagesA
      : slot === "B"
        ? messagesB
        : slot === "C"
          ? messagesC
          : messagesD;
  }
  function setMessages(slot, next) {
    if (slot === "A") messagesA = next;
    else if (slot === "B") messagesB = next;
    else if (slot === "C") messagesC = next;
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
    slotErrors = { ...slotErrors, [slot]: message || "" };
  }

  // detectLoop imported from arenaLogic.js

  /** Effective settings for one Arena slot: per-model effective + per-slot session overrides. */
  function getSettingsForSlot(slot) {
    const modelId =
      slot === "A"
        ? $dashboardModelA
        : slot === "B"
          ? $dashboardModelB
          : slot === "C"
            ? $dashboardModelC
            : $dashboardModelD;
    const base = getEffectiveSettingsForModel(modelId || "");
    const over = $arenaSlotOverrides[slot];
    if (!over || Object.keys(over).length === 0) return base;
    return {
      ...base,
      ...over,
      system_prompt:
        over.system_prompt !== undefined && over.system_prompt !== ""
          ? over.system_prompt
          : base.system_prompt,
    };
  }

  // ---------- Stream / send ----------
  const ARENA_TIMEOUT_MS = 120000; // spec: timeout_seconds_per_model: 120

  /**
   * Send one question to one model in one Arena slot.
   *
   * CRITICAL DESIGN RULES (Sequential Model Arena spec):
   *   1. The model receives ONLY: system prompt (optional) + the question. Nothing else.
   *      No history, no judge text, no scoring format, no competition framing.
   *   2. The question text may include contest rules (prepended by caller) — but those
   *      rules must never mention judges, scoring, other models, or competition.
   *   3. A 120 s hard timeout aborts the stream if the model hangs.
   *
   * @param {string} slot  - 'A'|'B'|'C'|'D'
   * @param {string} modelId
   * @param {string|Array} question      - What the model sees (may include contest rules).
   * @param {string|Array} displayQuestion - What the user sees in the UI bubble (question only).
   * @returns {Promise<{ latency_ms: number, token_count: number|null, timestamp: number }|undefined>}
   */
  async function sendToSlot(slot, modelId, question, displayQuestion) {
    // --- Reset slot state ---
    setRunning(slot, true);
    setSlotError(slot, "");

    // --- UI messages (what the user sees in the panel) ---
    const userMsgId = generateId();
    pushMessage(slot, {
      id: userMsgId,
      role: "user",
      content: displayQuestion || question,
      createdAt: Date.now(),
    });
    const assistantMsgId = generateId();
    pushMessage(slot, {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      stats: null,
      modelId,
      createdAt: Date.now(),
    });

    // --- Build API payload: hardcoded clean system prompt + question. Nothing else. ---
    // CRITICAL: We use a hardcoded system prompt that NEVER mentions judges, scoring,
    // competition, or other models. Cached/persisted user settings are IGNORED for
    // contestants because they may contain old toxic "Arena contestant" text from
    // localStorage that causes models to hallucinate scoring patterns.
    const slotOpts = getSettingsForSlot(slot);
    const messages = [
      { role: "system", content: ARENA_CONTESTANT_SYSTEM_PROMPT },
      { role: "user", content: question },
    ];

    // --- Abort controller + 120 s hard timeout ---
    const controller = new AbortController();
    aborters[slot] = controller;
    const timeoutId = setTimeout(() => controller.abort(), ARENA_TIMEOUT_MS);

    // --- Stream ---
    const startMs = performance.now();
    let fullContent = "";
    let usage = null;
    let elapsedMs = 0;
    lastSampleAt = Date.now();
    lastSampleTokens = 0;

    try {
      const result = await streamChatCompletion({
        model: modelId,
        messages,
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
        },
        onChunk(chunk) {
          fullContent += chunk;
          if (detectLoop(fullContent)) {
            controller.abort();
            return;
          }
          const estTokens = Math.max(1, Math.ceil(fullContent.length / 4));
          liveTokens.set(estTokens);
          const now = Date.now();
          if (now - lastSampleAt >= 1000) {
            const rate = (estTokens - lastSampleTokens) / ((now - lastSampleAt) / 1000);
            if (rate >= 0) pushTokSample(rate);
            lastSampleAt = now;
            lastSampleTokens = estTokens;
          }
          updateMessage(slot, assistantMsgId, { content: fullContent, modelId });
        },
        onUsage(u) {
          usage = u;
        },
      });

      elapsedMs = result.elapsedMs ?? Math.round(performance.now() - startMs);
      if (result.usage) usage = result.usage;
      if ($settings.audio_enabled && !result?.aborted)
        playComplete($settings.audio_volume);
    } catch (err) {
      if (err?.name !== "AbortError") {
        setSlotError(slot, err?.message || "Failed to get response.");
      }
      updateMessage(slot, assistantMsgId, { content: sanitizeContestantResponse(fullContent) || "", stats: null, modelId });
      return undefined;
    } finally {
      clearTimeout(timeoutId);
      setRunning(slot, false);
      aborters[slot] = null;
    }

    // --- Sanitize: strip any judge-pattern lines the model may have hallucinated ---
    fullContent = sanitizeContestantResponse(fullContent);

    // --- Finalize stats ---
    const estTokens = Math.max(1, Math.ceil(fullContent.length / 4));
    const tokenCount = usage?.completion_tokens != null
      ? (usage.prompt_tokens || 0) + usage.completion_tokens
      : null;
    updateMessage(slot, assistantMsgId, {
      content: fullContent,
      stats: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? estTokens,
        elapsed_ms: elapsedMs,
        estimated: !usage?.completion_tokens,
      },
      modelId,
    });
    return { latency_ms: elapsedMs, token_count: tokenCount, timestamp: Date.now() };
  }

  async function sendUserMessage(text, imageDataUrls = []) {
    if (!text || !String(text).trim() || $isStreaming) return;
    chatError.set(null);

    let effectiveText = String(text).trim();
    const webMode = get(arenaWebSearchMode);
    if (webMode === "all" && get(webSearchForNextMessage)) {
      // Stay connected: don't turn off webSearchForNextMessage after send.
      // User toggles it off manually via the globe button.
      webSearchInProgress.set(true);
      try {
        const searchResult = await searchDuckDuckGo(effectiveText);
        webSearchConnected.set(true);
        const formatted = formatSearchResultForChat(
          effectiveText,
          searchResult,
        );
        effectiveText = formatted + "\n\n---\nUser question: " + effectiveText;
      } catch (e) {
        webSearchConnected.set(false);
        chatError.set(
          e?.message ||
            "Web search failed. Click the globe to retry or send without internet.",
        );
        webSearchInProgress.set(false);
        throw e; // Propagate so ChatInput restores the user's typed message.
      }
      webSearchInProgress.set(false);
    }

    const n = get(arenaPanelCount);
    const slotsActive = [
      "A",
      ...(n >= 2 ? ["B"] : []),
      ...(n >= 3 ? ["C"] : []),
      ...(n >= 4 ? ["D"] : []),
    ];
    let selected = [
      { slot: "A", modelId: $dashboardModelA },
      { slot: "B", modelId: $dashboardModelB },
      { slot: "C", modelId: $dashboardModelC },
      { slot: "D", modelId: $dashboardModelD },
    ].filter((s) => s.modelId && slotsActive.includes(s.slot));

    if (!selected.length) {
      chatError.set("Select at least one model (A–D) before sending.");
      return;
    }

    runId += 1;
    const currentRun = runId;
    liveTokens.set(0);
    isStreaming.set(true);
    try {
      const rulesPrefix = (typeof contestRules === "string"
        ? contestRules
        : ""
      ).trim()
        ? contestRules.trim() + "\n\n---\n\n"
        : "";
      const textWithRules = rulesPrefix + effectiveText;
      const urls = Array.isArray(imageDataUrls) ? imageDataUrls : [];
      const needResize =
        urls.length > 0 &&
        !selected.every((s) => shouldSkipImageResizeForVision(s.modelId));
      const urlsForApi = urls.length
        ? needResize
          ? await resizeImageDataUrlsForVision(urls)
          : urls
        : [];
      // API content: full text with rules (what the model sees)
      const content = urlsForApi.length
        ? [
            { type: "text", text: textWithRules },
            ...urlsForApi.map((url) => ({
              type: "image_url",
              image_url: { url, ...(needResize ? { detail: "low" } : {}) },
            })),
          ]
        : textWithRules;
      // Display content: question only, no rules (what the user sees in the panel)
      const displayContent = urlsForApi.length
        ? [
            { type: "text", text: effectiveText },
            ...urlsForApi.map((url) => ({
              type: "image_url",
              image_url: { url, ...(needResize ? { detail: "low" } : {}) },
            })),
          ]
        : effectiveText;

      if (runId !== currentRun) return;

      const runIdUuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "run-" + Date.now();
      const runSeed = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
      arenaCurrentRunMeta = {
        run_id: runIdUuid,
        seed: runSeed,
        question_index: questionIndex,
        prompt_text: effectiveText,
        model_list: selected.map((s) => ({ slot: s.slot, model_id: s.modelId })),
        judge_model: null,
        deterministic_judge: get(arenaDeterministicJudge),
        blind_review: get(arenaBlindReview),
        start_timestamp: Date.now(),
        responses: {},
      };
      if (typeof console !== "undefined" && console.log) {
        console.log("[Arena run start]", { run_id: arenaCurrentRunMeta.run_id, seed: arenaCurrentRunMeta.seed, question_index: questionIndex });
      }

      /* Clear all slot messages so old responses/judge text don't leak into new run. */
      messagesA = [];
      messagesB = [];
      messagesC = [];
      messagesD = [];

      /* Eject every loaded model so the first contestant has full VRAM. Uses native API (no helper needed). */
      arenaTransitionPhase = "ejecting";
      await unloadAllModelsNative();
      const loadedBefore = await getLoadedModelKeys();
      if (loadedBefore.length > 0) {
        await waitUntilUnloaded(loadedBefore, {
          pollIntervalMs: 400,
          timeoutMs: 25000,
        });
      }
      await new Promise((r) => setTimeout(r, 1000));
      arenaTransitionPhase = null;
      if (runId !== currentRun) return;

      /* Arena runs one model at a time: load first contestant, then for each slot answer → eject → load next. */
      arenaTransitionPhase = "loading";
      try {
        if (selected[0]?.modelId) await loadModel(selected[0].modelId);
      } catch (_) {
        /* Load may fail; sendToSlot may load on demand */
      }
      arenaTransitionPhase = null;
      if (runId !== currentRun) return;

      let completedCount = 0;
      let failedSlots = [];
      const maxAttempts = 2;
      for (let i = 0; i < selected.length; i++) {
        if (runId !== currentRun) break;
        const s = selected[i];
        let lastErr = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const metrics = await sendToSlot(s.slot, s.modelId, content, displayContent);
            completedCount++;
            if (metrics && arenaCurrentRunMeta) {
              const msgs = getMessages(s.slot);
              const lastAsst = [...msgs].reverse().find((m) => m.role === "assistant");
              const raw_response = lastAsst ? contentToText(lastAsst.content) : "";
              arenaCurrentRunMeta.responses[s.slot] = {
                model_id: s.modelId,
                prompt: effectiveText,
                raw_response,
                latency_ms: metrics.latency_ms,
                token_count: metrics.token_count,
                timestamp: metrics.timestamp,
              };
            }
            lastErr = null;
            break;
          } catch (slotErr) {
            lastErr = slotErr;
            if (attempt === maxAttempts) {
              failedSlots.push(s.slot);
              setSlotError(s.slot, slotErr?.message || "Failed to get response.");
            }
          }
        }
        /* Always unload current contestant so only one model is ever loaded (including after the last slot). */
        if (runId !== currentRun) break;
        arenaTransitionPhase = "ejecting";
        try {
          if (s.modelId) {
            await unloadModel(s.modelId);
            await waitUntilUnloaded([s.modelId], { pollIntervalMs: 400, timeoutMs: 15000 });
          }
        } catch (_) {
          /* LM Studio may not support unload or already unloaded; continue */
        }
        arenaTransitionPhase = null;
        if (runId !== currentRun) break;
        const next = selected[i + 1];
        if (next?.modelId) {
          arenaTransitionPhase = "loading";
          try {
            await loadModel(next.modelId);
          } catch (_) {
            /* Load may fail; sendToSlot will load on demand */
          }
          arenaTransitionPhase = null;
        }
      }
      /* All contestants have run and the last one has been unloaded. Now run judge (one model at a time). */
      if (runId === currentRun) {
        isStreaming.set(false);
        liveTokens.set(null);
        liveTokPerSec.set(null);
        setTimeout(() => runJudgment(), 500);
      }
      if (failedSlots.length > 0 && completedCount > 0) {
        chatError.set(
          `${completedCount}/${selected.length} models completed. Failed: ${failedSlots.join(", ")}.`,
        );
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        chatError.set(err?.message || "Something went wrong. Try again.");
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
    for (const slot of ["A", "B", "C", "D"]) {
      try {
        aborters[slot]?.abort();
      } catch (_) {}
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
    if ($settings.audio_enabled && $settings.audio_clicks)
      playClick($settings.audio_volume);
  }

  /** Advance question index without sending (for "next" arrow when only navigating). */
  function advanceQuestionIndex() {
    if (currentQuestionTotal === 0) return;
    questionIndex = (questionIndex + 1) % currentQuestionTotal;
    if ($settings.audio_enabled && $settings.audio_clicks)
      playClick($settings.audio_volume);
  }

  /** Jump to a specific question by number (1-based). Does not send. */
  function jumpToQuestion(num) {
    const n = parseInt(num, 10);
    if (Number.isNaN(n) || currentQuestionTotal === 0) return;
    questionIndex = Math.max(0, Math.min(n - 1, currentQuestionTotal - 1));
    if ($settings.audio_enabled && $settings.audio_clicks)
      playClick($settings.audio_volume);
  }

  /** Ask: send the currently selected question to the models. (Standard test flow: select question, click Ask.) */
  function askCurrentQuestion() {
    if ($isStreaming) return;
    const questions = parsedQuestions;
    if (questions.length === 0) return;
    const idx = questionIndex % questions.length;
    const toSend = (questions[idx] && String(questions[idx]).trim()) || "";
    if (!toSend) return;
    messagesA = [];
    messagesB = [];
    messagesC = [];
    messagesD = [];
    chatError.set(null);
    if ($settings.audio_enabled && $settings.audio_clicks)
      playClick($settings.audio_volume);
    sendUserMessage(toSend, []).catch((e) => {
      chatError.set(e?.message || "Failed to send question.");
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
    const toSend = (questions[idx] && String(questions[idx]).trim()) || "";
    if (!toSend) return;
    messagesA = [];
    messagesB = [];
    messagesC = [];
    messagesD = [];
    chatError.set(null);
    if ($settings.audio_enabled && $settings.audio_clicks)
      playClick($settings.audio_volume);
    sendUserMessage(toSend, []).catch((e) => {
      chatError.set(e?.message || "Failed to send question.");
    });
  }

  /** Run All: iterate through all questions, send each, then run automated scoring after each. */
  async function runAllQuestions() {
    if ($isStreaming || runAllActive) return;
    const questions = parsedQuestions;
    if (questions.length === 0) return;
    const hasJudgeModel = get(models).length > 0; // judge will be auto-selected from non-contestants
    const ok = await confirm({
      title: "Run all questions",
      message: `This will run ${questions.length} question${questions.length > 1 ? "s" : ""} sequentially${hasJudgeModel ? " with automated scoring after each" : ""}. This may take a while.`,
      confirmLabel: "Run all",
      cancelLabel: "Cancel",
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
        const toSend = (questions[i] && String(questions[i]).trim()) || "";
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
            if (!running.A && !running.B && !running.C && !running.D) {
              r();
              return;
            }
            setTimeout(check, 500);
          };
          check();
        });
        // Run automated scoring after each question when Slot A has a model
        if (hasJudgeModel && runAllActive) {
          const n = get(arenaPanelCount);
          const hasResponses =
            (n >= 1 && messagesA.length > 0) ||
            (n >= 2 && messagesB.length > 0) ||
            (n >= 3 && messagesC.length > 0) ||
            (n >= 4 && messagesD.length > 0);
          if (hasResponses) {
            try {
              await runJudgment();
            } catch (e) {
              chatError.set(
                e?.message || `Scoring failed on question ${i + 1}.`,
              );
            }
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
      title: "Reset all scores",
      message: "Clear B/C/D score totals? This cannot be undone.",
      confirmLabel: "Reset",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (ok) {
      resetArenaScores();
      arenaSettingsOpen = false;
    }
  }

  async function confirmEjectAll() {
    const ok = await confirm({
      title: "Eject all models",
      message:
        "Unload all loaded models to free VRAM. You can load again from the sidebar.",
      confirmLabel: "Eject all",
      cancelLabel: "Cancel",
      danger: false,
    });
    if (ok) {
      arenaSettingsOpen = false;
      ejectAllModels();
    }
  }

  // ---------- Automated judgment: eject contestants → load scoring model → evaluate against answer key → show popup ----------
  async function runJudgment() {
    if ($isStreaming) return;
    const n = get(arenaPanelCount);
    const contestantIds = [
      get(dashboardModelA),
      n >= 2 ? get(dashboardModelB) : null,
      n >= 3 ? get(dashboardModelC) : null,
      n >= 4 ? get(dashboardModelD) : null,
    ].filter(Boolean);
    const pick = pickJudgeModel({
      userChoice: get(arenaScoringModelId)?.trim() || "",
      contestantIds,
      availableModels: get(models),
    });
    if (!pick.id) {
      chatError.set(pick.error || "No judge model available. Load a model that is not assigned to any Arena slot.");
      return;
    }
    if (pick.fallback && typeof console !== "undefined") {
      console.log("[Arena] Judge auto-selected:", pick.id, "(user choice was a contestant or unset)");
    }
    const judgeId = pick.id;
    if (arenaCurrentRunMeta) arenaCurrentRunMeta.judge_model = judgeId;
    const feedback =
      typeof judgeFeedback === "string" ? judgeFeedback.trim() : "";
    const slotsWithResponses = [
      n >= 1 && messagesA.length ? { slot: "A", msgs: messagesA } : null,
      n >= 2 && messagesB.length ? { slot: "B", msgs: messagesB } : null,
      n >= 3 && messagesC.length ? { slot: "C", msgs: messagesC } : null,
      n >= 4 && messagesD.length ? { slot: "D", msgs: messagesD } : null,
    ].filter(Boolean);
    if (!slotsWithResponses.length) {
      chatError.set("Run a question so all contestants respond first.");
      return;
    }
    try {
      arenaTransitionPhase = "ejecting";
      await unloadAllModelsNative();
      const loadedBefore = await getLoadedModelKeys();
      if (loadedBefore.length > 0) {
        await waitUntilUnloaded(loadedBefore, {
          pollIntervalMs: 400,
          timeoutMs: 25000,
        });
      }
      await new Promise((r) => setTimeout(r, 1000));
      judgeLoadingMessageIndex = Math.floor(Math.random() * JUDGE_LOADING_LINES.length);
      arenaTransitionPhase = "loading_judge";
      try {
        await loadModel(judgeId);
      } catch (_) {}
      arenaTransitionPhase = null;
    } finally {
      arenaTransitionPhase = null;
    }

    const lastUserMsg = slotsWithResponses[0].msgs
      .filter((m) => m.role === "user")
      .pop();
    const promptText = lastUserMsg ? contentToText(lastUserMsg.content) : "";
    let judgeWebContext = "";
    if (get(arenaWebSearchMode) === "all" && get(webSearchForNextMessage) && promptText.trim()) {
      webSearchInProgress.set(true);
      arenaTransitionPhase = "judge_web";
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
    const useBlindReview = get(arenaBlindReview);
    const useDeterministicJudge = get(arenaDeterministicJudge);
    const shuffleRandom = arenaCurrentRunMeta ? makeSeededRandom(arenaCurrentRunMeta.seed) : undefined;
    let responseOrder = null;
    const { messages } = useBlindReview
      ? (() => {
          const out = buildJudgePromptBlind({
            slotsWithResponses,
            answerKeyTrimmed,
            judgeWebContext,
            promptText,
            judgeFeedback: feedback,
            judgeInstructions,
            shuffleRandom,
          });
          responseOrder = out.responseOrder;
          return { messages: out.messages };
        })()
      : buildJudgePrompt({
          slotsWithResponses,
          answerKeyTrimmed,
          judgeWebContext,
          promptText,
          judgeFeedback: feedback,
          judgeInstructions,
        });
    chatError.set(null);
    const controller = new AbortController();
    aborters["A"] = controller;
    const judgeTimeoutId = setTimeout(() => controller.abort(), ARENA_TIMEOUT_MS);
    let fullContent = "";
    const judgeOpts = getSettingsForSlot("A");
    try {
      arenaTransitionPhase = "scoring";
      await streamChatCompletion({
        model: judgeId,
        messages,
        options: {
          temperature: useDeterministicJudge ? 0 : judgeOpts.temperature,
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
        },
      });
      fullContent = fullContent.replace(
        /([.!?;])\s*(Model\s+[A-D]:)/gi,
        "$1\n\n$2",
      );
      fullContent = fullContent.replace(
        /([.!?;])\s*(Response\s+\d+:)/gi,
        "$1\n\n$2",
      );
      let roundScores;
      let displayExplanation = fullContent;
      let popupExplanations = /** @type {Record<string, string> | undefined} */ (undefined);
      if (useBlindReview && responseOrder) {
        const blind = parseBlindJudgeScores(fullContent, responseOrder);
        roundScores = blind.scores;
        popupExplanations = blind.explanations;
        const lines = ["A", "B", "C", "D"]
          .filter((slot) => roundScores[slot] !== undefined)
          .map((slot) => `Model ${slot}: ${roundScores[slot]}/10 - ${(blind.explanations[slot] || "").trim() || "—"}`);
        displayExplanation = lines.join("\n");
      } else {
        roundScores = parseJudgeScores(fullContent);
      }
      const qIdx = questionIndex % Math.max(1, parsedQuestions.length);
      const parsedOk = Object.keys(roundScores).length > 0;
      if (!parsedOk && slotsWithResponses.length > 0) {
        chatError.set("Judge output could not be parsed. See modal for raw output.");
        if (typeof console !== "undefined" && console.error) {
          console.error("[Arena judge_failure] abort_and_log_error", { raw_output: fullContent, run_id: arenaCurrentRunMeta?.run_id });
        }
        judgmentPopup = {
          scores: {},
          explanation: "Judge returned malformed output (no scores parsed). Raw output below.\n\n---\n\n" + fullContent,
          rawJudgeOutput: fullContent,
          questionIndex: qIdx,
          explanations: undefined,
        };
      } else {
        if (parsedOk) {
          const qText = parsedQuestions[qIdx] || "(free-form prompt)";
          scoreHistory = addScoreRound(scoreHistory, qIdx, qText, roundScores);
          arenaScores = computeTotals(scoreHistory);
        }
        judgmentPopup = {
          scores: roundScores,
          explanation: displayExplanation,
          rawJudgeOutput: fullContent,
          questionIndex: qIdx,
          explanations: popupExplanations,
        };
      }
      if (typeof console !== "undefined" && console.log && arenaCurrentRunMeta) {
        console.log("[Arena run metadata]", {
          run_id: arenaCurrentRunMeta.run_id,
          seed: arenaCurrentRunMeta.seed,
          question_index: arenaCurrentRunMeta.question_index,
          deterministic_judge: arenaCurrentRunMeta.deterministic_judge,
          blind_review: arenaCurrentRunMeta.blind_review,
          model_list: arenaCurrentRunMeta.model_list,
          judge_model: arenaCurrentRunMeta.judge_model,
          responses: arenaCurrentRunMeta.responses,
          scores: roundScores,
        });
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        const msg = err?.message || "Scoring request failed.";
        chatError.set(msg);
        const qIdx = questionIndex % Math.max(1, parsedQuestions.length);
        judgmentPopup = {
          scores: {},
          explanation: "Scoring failed: " + msg + (fullContent ? "\n\n--- Raw judge output ---\n\n" + fullContent : ""),
          rawJudgeOutput: fullContent || "",
          questionIndex: qIdx,
        };
        if (typeof console !== "undefined" && console.error) {
          console.error("[Arena judge_failure] abort_and_log_error", { error: msg, raw_output: fullContent, run_id: arenaCurrentRunMeta?.run_id });
        }
      }
    } finally {
      clearTimeout(judgeTimeoutId);
      aborters["A"] = null;
      // Unload judge model after scoring (spec: UNLOAD_JUDGE_MODEL → VERIFY_MODEL_UNLOADED)
      arenaTransitionPhase = "ejecting";
      try {
        if (judgeId) {
          await unloadModel(judgeId);
          await waitUntilUnloaded([judgeId], { pollIntervalMs: 400, timeoutMs: 15000 });
        }
      } catch (_) { /* best-effort */ }
      arenaTransitionPhase = null;
    }
  }

  async function ejectAllModels() {
    if (ejectBusy) return;
    ejectBusy = true;
    ejectMessage = null;
    chatError.set(null);
    try {
      const result = await unloadAllModelsNative();
      if (result?.ok) {
        ejectMessage = `All models ejected (${result.unloaded} instance${result.unloaded !== 1 ? "s" : ""}).`;
      } else {
        ejectMessage = "Could not eject models. Is LM Studio running?";
      }
      setTimeout(() => {
        ejectMessage = null;
      }, 4000);
    } finally {
      ejectBusy = false;
    }
  }

  // ---------- Ask the Judge (side conversation; kept for possible future use) ----------
  async function askTheJudge() {
    if (askJudgeLoading || !askJudgeQuestion.trim()) return;
    const judgeId = get(dashboardModelA);
    if (!judgeId) {
      chatError.set("Select a model in Slot A to use as judge.");
      return;
    }
    askJudgeLoading = true;
    askJudgeReply = "";
    chatError.set(null);

    // Build context: original question, model responses, judge's scoring
    const n = get(arenaPanelCount);
    const slotsWithResponses = [
      n >= 2 && messagesB.length ? { slot: "B", msgs: messagesB } : null,
      n >= 3 && messagesC.length ? { slot: "C", msgs: messagesC } : null,
      n >= 4 && messagesD.length ? { slot: "D", msgs: messagesD } : null,
    ].filter(Boolean);

    const lastUserMsg = slotsWithResponses.length
      ? slotsWithResponses[0].msgs.filter((m) => m.role === "user").pop()
      : null;
    const promptText = lastUserMsg ? contentToText(lastUserMsg.content) : "";

    const contextParts = [
      "You are a judge in a model arena competition. You were given an answer key and contest rules (see below) to use when scoring. The user may ask you about your scoring, the answer key, or how you use it. Answer thoughtfully and concisely; do NOT re-score.",
      "",
    ];
    // Answer for current question (if any); otherwise judge used web or own knowledge
    const answerForQuestion = currentQuestionAnswer;
    if (answerForQuestion) {
      contextParts.push(
        "--- ANSWER KEY (use this to evaluate accuracy; it was provided to you when you scored) ---",
        answerForQuestion,
        "",
      );
    } else {
      contextParts.push(
        "--- ANSWER KEY ---",
        "(None provided for this question; you used web or your own knowledge.)",
        "",
      );
    }
    // Contest rules (Arena settings)
    const rulesTrimmed =
      typeof contestRules === "string" ? contestRules.trim() : "";
    if (rulesTrimmed) {
      contextParts.push("--- CONTEST RULES ---", rulesTrimmed, "");
    }
    contextParts.push("--- ORIGINAL PROMPT ---", promptText || "(none)", "");
    for (const { slot, msgs } of slotsWithResponses) {
      const lastAssistant = [...msgs]
        .reverse()
        .find((m) => m.role === "assistant");
      const text = lastAssistant ? contentToText(lastAssistant.content) : "";
      contextParts.push(
        `--- MODEL ${slot} RESPONSE ---`,
        text.trim() || "(no response)",
        "",
      );
    }
    // Include judge's last scoring if available
    const lastJudgeMsg = [...messagesA]
      .reverse()
      .find((m) => m.role === "assistant");
    if (lastJudgeMsg) {
      contextParts.push(
        "--- YOUR PREVIOUS SCORING ---",
        contentToText(lastJudgeMsg.content).trim(),
        "",
      );
    }
    contextParts.push("--- USER QUESTION ---", askJudgeQuestion.trim());

    const systemContent = answerForQuestion
      ? "You are a competition judge. You have been given the answer key and (if any) contest rules in the user message. Use them when answering questions about your scoring. Do NOT re-score. Do NOT invent new rules; only use the provided Contest Rules. If the previous score seems wrong, explain the discrepancy but do not change the score."
      : "You are a competition judge. Answer the user's question about your scoring thoughtfully and concisely. Do NOT re-score. Do NOT invent new rules; only use the provided Contest Rules.";

    const messages = [
      { role: "system", content: systemContent },
      { role: "user", content: contextParts.join("\n") },
    ];
    console.log(
      "[Ask Judge] Prompt:",
      messages.map((m) => m.role + ": " + m.content).join("\n---\n"),
    );

    const controller = new AbortController();
    const askJudgeOpts = getSettingsForSlot("A");
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
      if (err?.name !== "AbortError") {
        askJudgeReply = `Error: ${err?.message || "Request failed."}`;
      }
    } finally {
      askJudgeLoading = false;
    }
  }

  function lastTps(msgs) {
    const last = [...(msgs || [])]
      .reverse()
      .find((m) => m.role === "assistant" && m.stats);
    if (!last?.stats) return null;
    const { completion_tokens, elapsed_ms } = last.stats;
    if (elapsed_ms <= 0) return null;
    return (completion_tokens / (elapsed_ms / 1000)).toFixed(1);
  }
  const tpsA = $derived(lastTps(messagesA));
  const tpsB = $derived(lastTps(messagesB));
  const tpsC = $derived(lastTps(messagesC));
  const tpsD = $derived(lastTps(messagesD));

  // ---------- Derived slot data for ArenaPanel loop ----------
  const slotData = $derived.by(() => {
    const modelIds = {
      A: $dashboardModelA,
      B: $dashboardModelB,
      C: $dashboardModelC,
      D: $dashboardModelD,
    };
    const messages = { A: messagesA, B: messagesB, C: messagesC, D: messagesD };
    const tps = { A: tpsA, B: tpsB, C: tpsC, D: tpsD };
    const effectiveSettings = {
      A: effectiveForA,
      B: effectiveForB,
      C: effectiveForC,
      D: effectiveForD,
    };

    // Only include slots that are active based on arenaPanelCount
    return SLOTS.slice(0, $arenaPanelCount).map((slot) => ({
      slot,
      modelId: modelIds[slot],
      messages: messages[slot],
      running: running[slot],
      slotError: slotErrors[slot],
      tps: tps[slot],
      score: arenaScores[slot] ?? 0,
      standingLabel: arenaStandingLabel(slot, arenaScores),
      effectiveSettings: effectiveSettings[slot],
      accentColor: SLOT_COLORS[slot],
      showScore: slot !== "A",
    }));
  });

  // ---------- Layout (resizable panel widths) ----------
  function loadPanelWidths() {
    if (typeof localStorage === "undefined") return [25, 25, 25, 25];
    try {
      const r = JSON.parse(localStorage.getItem("arenaPanelWidths") || "[]");
      return r.length === 4 ? r : [25, 25, 25, 25];
    } catch {
      return [25, 25, 25, 25];
    }
  }
  let panelWidths = $state(loadPanelWidths());
  function savePanelWidths() {
    if (typeof localStorage !== "undefined")
      localStorage.setItem("arenaPanelWidths", JSON.stringify(panelWidths));
  }
  const gridCols = $derived.by(() => {
    const n = $arenaPanelCount;
    const ws = panelWidths.slice(0, n);
    const sum = ws.reduce((a, b) => a + b, 0) || 100;
    return ws.map((w) => ((w / sum) * 100).toFixed(2) + "%").join(" ");
  });

  let resizing = $state(-1);
  let resizeStartX = $state(0);
  let resizeStartWidths = $state([]);
  let gridEl = $state(null);

  function startResize(index, e) {
    resizing = index;
    resizeStartX = e.clientX;
    resizeStartWidths = [...panelWidths];
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
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
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    savePanelWidths();
  }

  /** Helper to compute cumulative width percentage for resize handle positioning */
  function cumWidthPercent(i) {
    const activeWidths = panelWidths.slice(0, $arenaPanelCount);
    const total = activeWidths.reduce((a, b) => a + b, 0) || 100;
    const sum = activeWidths.slice(0, i + 1).reduce((a, b) => a + b, 0);
    return (sum / total) * 100;
  }

  $effect(() => {
    if (typeof document === "undefined") return;
    if (resizing < 0) return;
    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", endResize);
    return () => {
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", endResize);
    };
  });

  /* ── Responsive: detect narrow viewport ── */
  let windowWidth = $state(
    typeof window !== "undefined" ? window.innerWidth : 1200,
  );
  $effect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      windowWidth = window.innerWidth;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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
    if (el && typeof el.scrollTo === "function")
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }
  $effect(() => {
    messagesA;
    arenaScrollA && scrollPanelToBottom(arenaScrollA);
  });
  $effect(() => {
    messagesB;
    arenaScrollB && scrollPanelToBottom(arenaScrollB);
  });
  $effect(() => {
    messagesC;
    arenaScrollC && scrollPanelToBottom(arenaScrollC);
  });
  $effect(() => {
    messagesD;
    arenaScrollD && scrollPanelToBottom(arenaScrollD);
  });
</script>

<div
  class="h-full min-h-0 flex flex-col"
  role="region"
  aria-label="Arena drop zone"
  ondragover={(e) => {
    e.preventDefault();
    e.stopPropagation();
  }}
  ondrop={(e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (files?.length) pendingDroppedFiles.set(files);
  }}
>
  <!-- === Header: model cards A–D (selector + score) === -->
  <ArenaHeader
    arenaPanelCount={$arenaPanelCount}
    running={running}
    arenaScores={arenaScores}
    windowWidth={windowWidth}
  />

  <!-- === Arena control bar: Question | Run | Web | Judge | Tools === -->
  <ArenaControlBar
    currentQuestionNum={currentQuestionNum}
    currentQuestionTotal={currentQuestionTotal}
    parsedQuestions={parsedQuestions}
    runAllActive={runAllActive}
    runAllProgress={runAllProgress}
    arenaWebWarmingUp={arenaWebWarmingUp}
    arenaWebWarmUpAttempted={arenaWebWarmUpAttempted}
    prevQuestion={prevQuestion}
    jumpToQuestion={jumpToQuestion}
    advanceQuestionIndex={advanceQuestionIndex}
    askCurrentQuestion={askCurrentQuestion}
    askNextQuestion={askNextQuestion}
    runAllQuestions={runAllQuestions}
    stopRunAll={stopRunAll}
    runArenaWarmUp={runArenaWarmUp}
    startOver={startOver}
    onOpenSettings={() => (arenaSettingsOpen = true)}
  />

  <!-- === Sticky question text bar (always visible above panels) === -->
  {#if currentQuestionTotal > 0 && currentQuestionText}
    <div
      class="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b"
      style="background-color: color-mix(in srgb, var(--ui-accent) 6%, var(--ui-bg-main)); border-color: var(--ui-border);"
    >
      <span
        class="text-xs font-bold tabular-nums shrink-0"
        style="color: var(--ui-accent);">Q{currentQuestionNum}</span
      >
      <span
        class="text-xs truncate"
        style="color: var(--ui-text-primary);"
        title={currentQuestionText}>{currentQuestionText}</span
      >
    </div>
  {/if}

  <!-- === Response panels A–D (resizable) === -->
  <div
    bind:this={gridEl}
    class="flex-1 min-h-0 grid gap-2 p-3 atom-layout-transition relative grid-rows-[minmax(0,1fr)]"
    style="grid-template-columns: {responsiveGridCols};"
  >
    {#each slotData as data, i (data.slot)}
      {#if data.slot === "A"}
        <ArenaPanel
          slot={data.slot}
          modelId={data.modelId}
          messages={data.messages}
          running={data.running}
          slotError={data.slotError}
          tps={data.tps}
          score={data.score}
          standingLabel={data.standingLabel}
          effectiveSettings={data.effectiveSettings}
          optionsOpen={optionsOpenSlot === data.slot}
          onToggleOptions={() =>
            (optionsOpenSlot =
              optionsOpenSlot === data.slot ? null : data.slot)}
          onClear={() => {
            messagesA = [];
          }}
          bind:scrollRef={arenaScrollA}
          accentColor={data.accentColor}
          showScore={data.showScore}
          loadStatus={null}
        />
      {:else if data.slot === "B"}
        <ArenaPanel
          slot={data.slot}
          modelId={data.modelId}
          messages={data.messages}
          running={data.running}
          slotError={data.slotError}
          tps={data.tps}
          score={data.score}
          standingLabel={data.standingLabel}
          effectiveSettings={data.effectiveSettings}
          optionsOpen={optionsOpenSlot === data.slot}
          onToggleOptions={() =>
            (optionsOpenSlot =
              optionsOpenSlot === data.slot ? null : data.slot)}
          onClear={() => {
            messagesB = [];
          }}
          bind:scrollRef={arenaScrollB}
          accentColor={data.accentColor}
          showScore={data.showScore}
          loadStatus={null}
        />
      {:else if data.slot === "C"}
        <ArenaPanel
          slot={data.slot}
          modelId={data.modelId}
          messages={data.messages}
          running={data.running}
          slotError={data.slotError}
          tps={data.tps}
          score={data.score}
          standingLabel={data.standingLabel}
          effectiveSettings={data.effectiveSettings}
          optionsOpen={optionsOpenSlot === data.slot}
          onToggleOptions={() =>
            (optionsOpenSlot =
              optionsOpenSlot === data.slot ? null : data.slot)}
          onClear={() => {
            messagesC = [];
          }}
          bind:scrollRef={arenaScrollC}
          accentColor={data.accentColor}
          showScore={data.showScore}
          loadStatus={null}
        />
      {:else if data.slot === "D"}
        <ArenaPanel
          slot={data.slot}
          modelId={data.modelId}
          messages={data.messages}
          running={data.running}
          slotError={data.slotError}
          tps={data.tps}
          score={data.score}
          standingLabel={data.standingLabel}
          effectiveSettings={data.effectiveSettings}
          optionsOpen={optionsOpenSlot === data.slot}
          onToggleOptions={() =>
            (optionsOpenSlot =
              optionsOpenSlot === data.slot ? null : data.slot)}
          onClear={() => {
            messagesD = [];
          }}
          bind:scrollRef={arenaScrollD}
          accentColor={data.accentColor}
          showScore={data.showScore}
          loadStatus={null}
        />
      {/if}
      {#if i < slotData.length - 1 && !isMobile}
        <div
          class="hidden lg:block absolute top-0 bottom-0 w-2 cursor-col-resize z-10 group"
          style="left: calc({cumWidthPercent(i)}% - 4px);"
          onmousedown={(e) => startResize(i, e)}
          role="presentation"
        >
          <div
            class="w-px h-full mx-auto"
            style="background: transparent;"
          ></div>
        </div>
      {/if}
    {/each}
  </div>

  {#if arenaTransitionPhase}
    <div
      class="shrink-0 flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-lg mx-2 mb-1 border"
      style="background-color: var(--ui-input-bg); border-color: var(--ui-border); color: var(--ui-text-primary);"
      role="status"
      aria-live="polite"
    >
      <div class="flex items-center gap-2">
        <ThinkingAtom size={22} />
        <span class="text-sm font-medium">
          {#if arenaTransitionPhase === "loading_judge"}
            {JUDGE_LOADING_LINES[judgeLoadingMessageIndex].main}
          {:else if arenaTransitionPhase === "judge_web"}
            {JUDGE_WEB_LINES[judgeWebMessageIndex].main}
          {:else if arenaTransitionPhase === "ejecting"}
            Ejecting…
          {:else if arenaTransitionPhase === "scoring"}
            Scoring answers…
          {:else}
            New model loading
          {/if}
        </span>
      </div>
      {#if arenaTransitionPhase === "loading_judge"}
        <span
          class="text-xs opacity-80"
          style="color: var(--ui-text-secondary);"
          >{JUDGE_LOADING_LINES[judgeLoadingMessageIndex].sub}</span
        >
      {:else if arenaTransitionPhase === "judge_web"}
        <span
          class="text-xs opacity-80"
          style="color: var(--ui-text-secondary);"
          >{JUDGE_WEB_LINES[judgeWebMessageIndex].sub}</span
        >
      {/if}
    </div>
  {/if}

  <!-- Minimal footer: chat error + send -->
  <div
    class="shrink-0 border-t px-3 py-2"
    style="background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);"
  >
    {#if $chatError}
      <div
        class="mb-2 px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2"
        style="background: rgba(239,68,68,0.1); color: var(--ui-accent-hot); border: 1px solid var(--ui-border);"
        role="alert"
      >
        <span>{$chatError}</span>
        <button
          type="button"
          class="shrink-0 p-1 rounded hover:opacity-80"
          onclick={() => chatError.set(null)}
          aria-label="Dismiss">×</button
        >
      </div>
    {/if}
    <section class="max-w-2xl mx-auto w-full" aria-label="Send prompt">
      <ChatInput onSend={sendUserMessage} onStop={stopAll} />
    </section>
  </div>

  <!-- Floating question panel removed: question now shows cleanly in each slot's chat bubble -->

  <!-- Judgment result popup (scores + explanation after automated judging) -->
  {#if judgmentPopup}
    <div
      class="fixed inset-0 z-[250] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Judgment results"
    >
      <div
        class="absolute inset-0 bg-black/40"
        role="button"
        tabindex="-1"
        aria-label="Close"
        onclick={() => (judgmentPopup = null)}
        onkeydown={(e) => e.key === "Escape" && (judgmentPopup = null)}
      ></div>
      <div
        class="relative rounded-xl border shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden"
        style="background-color: var(--ui-bg-main); border-color: var(--ui-border);"
      >
        <div class="shrink-0 flex items-center justify-between px-4 py-3 border-b" style="border-color: var(--ui-border);">
          <h2 class="text-base font-semibold" style="color: var(--ui-text-primary);">Scores</h2>
            <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-2 py-1 rounded text-xs font-medium border transition-colors"
              style="color: var(--ui-text-secondary); border-color: var(--ui-border);"
              onclick={() => {
                const raw = judgmentPopup.rawJudgeOutput ?? judgmentPopup.explanation;
                const explanations =
                  judgmentPopup.explanations && Object.keys(judgmentPopup.explanations).length > 0
                    ? judgmentPopup.explanations
                    : parseJudgeScoresAndExplanations(judgmentPopup.explanation).explanations;
                const payload = {
                  questionIndex: judgmentPopup.questionIndex ?? -1,
                  scores: judgmentPopup.scores,
                  explanations: Object.keys(explanations || {}).length ? explanations : undefined,
                  rawExplanation: raw,
                };
                navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
              }}
              aria-label="Copy results as JSON">Copy JSON</button>
            <button
              type="button"
              class="px-2 py-1 rounded text-xs font-medium border transition-colors"
              style="color: var(--ui-text-secondary); border-color: var(--ui-border);"
              onclick={() => {
                const q = judgmentPopup.questionIndex ?? -1;
                const expl = judgmentPopup.explanations || {};
                const header = "questionIndex,slot,score,explanation";
                const rows = ["A", "B", "C", "D"]
                  .filter((slot) => judgmentPopup.scores[slot] !== undefined)
                  .map((slot) => {
                    const score = judgmentPopup.scores[slot];
                    const ex = (expl[slot] ?? "").replace(/"/g, '""');
                    return `${q},${slot},${score},"${ex}"`;
                  });
                const csv = [header, ...rows].join("\n");
                navigator.clipboard?.writeText(csv);
              }}
              aria-label="Copy results as CSV">Copy CSV</button>
            {#if arenaCurrentRunMeta}
              <button
                type="button"
                class="px-2 py-1 rounded text-xs font-medium border transition-colors"
                style="color: var(--ui-text-secondary); border-color: var(--ui-border);"
                onclick={() => {
                  const meta = {
                    run_id: arenaCurrentRunMeta.run_id,
                    seed: arenaCurrentRunMeta.seed,
                    timestamp: arenaCurrentRunMeta.start_timestamp,
                    question_index: arenaCurrentRunMeta.question_index,
                    deterministic_judge: arenaCurrentRunMeta.deterministic_judge,
                    blind_review: arenaCurrentRunMeta.blind_review,
                    model_list: arenaCurrentRunMeta.model_list,
                    judge_model: arenaCurrentRunMeta.judge_model,
                    responses: arenaCurrentRunMeta.responses,
                    scores: judgmentPopup.scores,
                  };
                  navigator.clipboard?.writeText(JSON.stringify(meta, null, 2));
                }}
                aria-label="Copy run metadata as JSON">Copy run metadata</button>
            {/if}
            <button
              type="button"
              class="p-2 rounded-lg hover:opacity-80"
              style="color: var(--ui-text-secondary);"
              onclick={() => (judgmentPopup = null)}
              aria-label="Close">×</button>
          </div>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-4" style="border-top: 1px solid var(--ui-border);">
          <div class="flex flex-col gap-3 pt-3">
            {#each ["A", "B", "C", "D"] as slot}
              {#if judgmentPopup.scores[slot] !== undefined}
                {@const color = SLOT_COLORS[slot]}
                {@const score = judgmentPopup.scores[slot]}
                {@const expl = judgmentPopup.explanations?.[slot] || ""}
                {@const fallbackExpl = !expl && judgmentPopup.explanation ? judgmentPopup.explanation : ""}
                <div class="rounded-lg border p-3" style="border-color: {color}40; background: {color}08;">
                  <div class="flex items-center justify-between mb-1.5">
                    <span class="text-sm font-semibold flex items-center gap-2">
                      <span class="inline-block w-2.5 h-2.5 rounded-full" style="background: {color};"></span>
                      Model {slot}
                    </span>
                    <span class="text-lg font-bold" style="color: {color};">{score}/10</span>
                  </div>
                  {#if expl}
                    <p class="text-sm leading-relaxed" style="color: var(--ui-text-secondary);">{expl}</p>
                  {/if}
                </div>
              {/if}
            {/each}
            {#if !judgmentPopup.explanations || Object.keys(judgmentPopup.explanations).length === 0}
              <div class="text-sm whitespace-pre-wrap mt-1" style="color: var(--ui-text-secondary);">
                {judgmentPopup.explanation}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- === Arena settings: slide-out from right (Questions, Answer key, Contest rules, Execution, Web search, Actions) === -->
  {#if arenaSettingsOpen}
    <div
      class="fixed inset-0 z-[200] transition-opacity duration-300"
      role="dialog"
      aria-modal="true"
      aria-label="Arena settings"
    >
      <div
        class="absolute inset-0 bg-black/30"
        role="button"
        tabindex="-1"
        aria-label="Close settings"
        onclick={() => (arenaSettingsOpen = false)}
        onkeydown={(e) => e.key === "Escape" && (arenaSettingsOpen = false)}
      ></div>
      <div
        class="absolute top-0 right-0 bottom-0 w-[320px] flex flex-col border-l shadow-xl transition-transform duration-300"
        style="background-color: var(--ui-bg-main); border-color: var(--ui-border);"
      >
        <div
          class="shrink-0 flex items-center justify-between px-4 py-4 border-b"
          style="border-color: var(--ui-border);"
        >
          <h2
            class="text-base font-semibold"
            style="color: var(--ui-text-primary);"
          >
            Arena settings
          </h2>
          <button
            type="button"
            class="p-2 rounded-lg hover:opacity-80"
            style="color: var(--ui-text-secondary);"
            onclick={() => (arenaSettingsOpen = false)}
            aria-label="Close">×</button
          >
        </div>
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          <!-- 1. Questions & answers (one block: optional Answer: per question) -->
          <section>
            <h3
              class="font-semibold text-sm mb-1"
              style="color: var(--ui-text-primary);"
            >
              Questions & answers
            </h3>
            <p class="text-xs mb-3" style="color: var(--ui-text-secondary);">
              Paste questions and optional answers in one place. Number each
              question (1. … 2. …). Add a line <strong>Answer: …</strong> under a
              question to give the judge that answer for scoring. If you omit Answer:
              for a question, the judge uses web (if on) or its own knowledge.
            </p>
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
              {@const withAnswers = parsedAnswers.filter(
                (a) => (a || "").trim().length > 0,
              ).length}
              <p
                class="text-[11px] mt-1.5 font-medium"
                style="color: var(--ui-accent);"
              >
                {parsedQuestions.length} question{parsedQuestions.length === 1
                  ? ""
                  : "s"} loaded · {withAnswers} with answers
              </p>
            {/if}
          </section>
          <!-- 2. Judge instructions (custom rubric) -->
          <section>
            <h3
              class="font-semibold text-sm mb-1"
              style="color: var(--ui-text-primary);"
            >
              Judge instructions
            </h3>
            <p class="text-xs mb-2" style="color: var(--ui-text-secondary);">
              Custom rubric or scoring instructions for the judge. Replaces the
              default "Score 1-10" preamble. Leave blank for default.
            </p>
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
            <h3
              class="font-semibold text-sm mb-1"
              style="color: var(--ui-text-primary);"
            >
              Judge feedback / correction
            </h3>
            <p class="text-xs mb-2" style="color: var(--ui-text-secondary);">
              Optional correction or rubric hint sent to the judge when scoring.
              Use this to steer scoring (e.g. "NFPA 72 requires X, not Y" or
              "weight conciseness higher"). Leave blank for default scoring.
            </p>
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
              onclick={() => (settingsRulesExpanded = !settingsRulesExpanded)}
              aria-expanded={settingsRulesExpanded}
            >
              Contest rules
              <span aria-hidden="true"
                >{settingsRulesExpanded ? "▼" : "▶"}</span
              >
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
            <h3
              class="font-semibold text-sm mb-3"
              style="color: var(--ui-text-primary);"
            >
              Execution
            </h3>
            <p class="text-sm mb-3" style="color: var(--ui-text-secondary);">
              One model at a time: each contestant loads, answers, then is ejected before the next. No more than one model is ever loaded.
            </p>
            <label class="flex items-start gap-2 cursor-pointer text-sm" style="color: var(--ui-text-secondary);">
              <input type="checkbox" bind:checked={$arenaBlindReview} class="rounded mt-0.5" style="accent-color: var(--ui-accent);" />
              <span>Blind review (judge sees "Response 1", "Response 2" in shuffled order — no model identity)</span>
            </label>
            <label class="flex items-start gap-2 cursor-pointer text-sm mt-2" style="color: var(--ui-text-secondary);">
              <input type="checkbox" bind:checked={$arenaDeterministicJudge} class="rounded mt-0.5" style="accent-color: var(--ui-accent);" />
              <span>Deterministic judge (temperature 0)</span>
            </label>
          </section>
          <!-- Web search -->
          <section>
            <h3
              class="font-semibold text-sm mb-3"
              style="color: var(--ui-text-primary);"
            >
              Web search
            </h3>
            <div
              class="flex rounded-lg border overflow-hidden"
              style="border-color: var(--ui-border);"
            >
              <button
                type="button"
                class="flex-1 px-2 py-1.5 text-xs font-medium transition-colors"
                class:opacity-70={$arenaWebSearchMode !== "none"}
                style="border-color: var(--ui-border); background: {$arenaWebSearchMode ===
                'none'
                  ? 'var(--ui-sidebar-active)'
                  : 'transparent'}; color: {$arenaWebSearchMode === 'none'
                  ? 'var(--ui-text-primary)'
                  : 'var(--ui-text-secondary)'}"
                onclick={() => {
                  arenaWebSearchMode.set("none");
                  if ($settings.audio_enabled && $settings.audio_clicks)
                    playClick($settings.audio_volume);
                }}>None</button
              >
              <button
                type="button"
                class="flex-1 px-2 py-1.5 text-xs font-medium transition-colors border-l"
                class:opacity-70={$arenaWebSearchMode !== "all"}
                style="border-color: var(--ui-border); background: {$arenaWebSearchMode ===
                'all'
                  ? 'var(--ui-sidebar-active)'
                  : 'transparent'}; color: {$arenaWebSearchMode === 'all'
                  ? 'var(--ui-text-primary)'
                  : 'var(--ui-text-secondary)'}"
                onclick={() => {
                  arenaWebSearchMode.set("all");
                  if ($settings.audio_enabled && $settings.audio_clicks)
                    playClick($settings.audio_volume);
                }}>All</button
              >
            </div>
          </section>
          <!-- Scoring model (for automated judging) -->
          <section>
            <h3 class="font-semibold text-sm mb-3" style="color: var(--ui-text-primary);">
              Judge model
            </h3>
            <p class="text-xs mb-2" style="color: var(--ui-text-secondary);">
              Model used to score answers after all contestants finish. Must NOT be a contestant. "Auto" picks the largest non-contestant model available.
            </p>
            <select
              class="w-full px-3 py-2 rounded-lg border text-sm"
              style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
              aria-label="Judge model"
              value={$arenaScoringModelId || "__auto__"}
              onchange={(e) => {
                const v = e.currentTarget?.value;
                arenaScoringModelId.set(v === "__auto__" || !v ? "" : v);
              }}
            >
              <option value="__auto__">Auto (largest non-contestant)</option>
              {#each $models.filter((m) => {
                const cIds = [
                  $dashboardModelA, $dashboardModelB, $dashboardModelC, $dashboardModelD
                ].map((s) => (s || "").trim().toLowerCase()).filter(Boolean);
                return !cIds.includes((m.id || "").trim().toLowerCase());
              }) as m (m.id)}
                <option value={m.id}>{m.id}</option>
              {/each}
            </select>
          </section>
          <!-- Score breakdown -->
          <section>
            <h3
              class="font-semibold text-sm mb-3"
              style="color: var(--ui-text-primary);"
            >
              Score breakdown
            </h3>
            <ArenaScoreMatrix
              {scoreHistory}
              totals={arenaScores}
              visibleSlots={$arenaPanelCount >= 4
                ? ["A", "B", "C", "D"]
                : $arenaPanelCount >= 3
                  ? ["A", "B", "C"]
                  : $arenaPanelCount >= 2
                    ? ["A", "B"]
                    : ["A"]}
            />
          </section>
          <!-- Actions -->
          <section>
            <h3
              class="font-semibold text-sm mb-3"
              style="color: var(--ui-text-primary);"
            >
              Actions
            </h3>
            <p class="text-xs mb-2" style="color: var(--ui-text-secondary);">
              Reset all scores sets A–D back to 0 so you can start a new
              competition. You can also use <strong>Reset scores</strong> in the
              bar above.
            </p>
            <div class="flex flex-col gap-2">
              <button
                type="button"
                class="w-full px-3 py-2 rounded-lg text-sm font-medium border"
                style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-secondary);"
                onclick={confirmResetScores}
              >
                Reset all scores
              </button>
              <button
                type="button"
                class="w-full px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-secondary);"
                disabled={ejectBusy}
                onclick={confirmEjectAll}
              >
                {ejectBusy ? "Ejecting…" : "Eject all models"}
              </button>
              {#if ejectMessage}
                <span
                  class="text-xs"
                  style="color: var(--atom-teal);"
                  role="status">{ejectMessage}</span
                >
              {/if}
            </div>
          </section>
        </div>
      </div>
    </div>
  {/if}
</div>
