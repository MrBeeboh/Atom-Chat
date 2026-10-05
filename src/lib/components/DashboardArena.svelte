<script>
  /**
   * DashboardArena (ATOM Arena): head-to-head model comparison. All four slots (A–D) are contestants.
   * Layout: header (model cards A–D with scores) → question bar (Q selector, Ask, Next, Web, Start Over, Settings) → response panels (resizable) → footer (ChatInput).
   * When the last contestant finishes, automated scoring runs (using Slot A's model for the scoring API) and a popup shows scores + brief explanation for each model.
   * Right slide-out: Arena settings (Questions, Answer key, Contest rules, Execution, Web search, Actions).
   */
  import { get } from "svelte/store";
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import { quintOut } from "svelte/easing";
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
    confirm,
    arenaBuilderInternetEnabled,
    arenaDebugMode,
    arenaSlotAIsJudge,
    arenaRequestTimeoutSeconds,
    arenaSequentialByContestant,
    braveApiKey,
  } from "$lib/stores.js";
  import { playClick, playComplete } from "$lib/audio.js";
  import {
    streamChatCompletion,
    requestChatCompletion,
    loadModel,
    waitUntilLoaded,
    unloadAllModelsNative,
    isLocalModelChatReady,
    modelSelectorPrimaryLine,
    decodeTokPerSec,
    isQwen38FlashNextSelection,
    modelDisplayName,
    flashNextHasVision,
  } from "$lib/api.js";
  import { assistantStatsFromUsage, modelPricingCatalog } from "$lib/modelPricing.js";
  import { prepareArenaModelList } from "$lib/arenaModelList.js";
  import { isArenaModelEligible } from "$lib/providerFunding.js";
  import {
    arenaRunPlan,
    arenaShortfallStatus,
    pickArenaLineup,
    postHocScoreTags,
  } from "$lib/arenaPick.js";
  import { groupModelsForSelector } from "$lib/modelGroups.js";
  import {
    searchDuckDuckGo,
    formatSearchResultForChat,
    warmUpSearchConnection,
    syncBraveKeyToProxy,
  } from "$lib/duckduckgo.js";
  import { listedModelCaps } from "$lib/modelCapabilities.js";
  import { pickThinkingOptions } from "$lib/thinkingControls.js";
  import ChatInput from "$lib/components/ChatInput.svelte";
  import ThinkingAtom from "$lib/components/ThinkingAtom.svelte";
  import ArenaPanel from "$lib/components/ArenaPanel.svelte";
  import ArenaScoreMatrix from "$lib/components/ArenaScoreMatrix.svelte";
  import ArenaControlBar from "$lib/components/ArenaControlBar.svelte";
  import ArenaLineup from "$lib/components/ArenaLineup.svelte";
  import ProviderCheckList from "$lib/components/ProviderCheckList.svelte";
  import ArenaLoadQuestionsModal from "$lib/components/ArenaLoadQuestionsModal.svelte";
  import {
    generateId,
    resizeImageDataUrlsForVision,
    shouldSkipImageResizeForVision,
  } from "$lib/utils.js";
  import {
    parseJudgeScores,
    parseJudgeScoresAndExplanations,
    parseJudgeScoresMerged,
    parseBlindJudgeScores,
    parseBlindJudgeScoresLenient,
    parseBlindJudgeScoresMerged,
    buildArenaJsonRepairPrompt,
    buildJudgePrompt,
    buildJudgePromptBlind,
    buildArenaQuestionGenerationPrompt,
    parseGeneratedQuestionSet,
    parseQuestionsAndAnswers,
    normalizeGeneratedQuestionSet,
    makeSeededRandom,
    pickJudgeModel,
    isCloudModel,
    slotsNeedVision,
    extractSvgMarkup,
    sanitizeContestantResponse,
    ARENA_CONTESTANT_SYSTEM_PROMPT,
    ARENA_SVG_ASK,
    readArenaColumnVisible,
    JUDGE_LOADING_LINES,
    ARENA_BUILD_LOADING_LINES,
    ARENA_LOADING_MODEL_LINES,
    detectLoop,
    contentToText,
    JUDGE_WEB_LINES,
    arenaStandingLabel,
    loadScoreHistory,
    addScoreRound,
    computeTotals,
    contestCategoryTotals,
    clearScoreHistory,
    buildArenaRunAllSteps,
    isArenaQuestionRoundComplete,
  } from "$lib/arenaLogic.js";
  import { buildArenaReport, roundEntryFromMessages } from "$lib/arenaReport.js";
  import { rowsForJudgedRound } from "$lib/arenaRecordRows.js";
  import { bytesToBase64, lastTps } from "$lib/arenaView.js";
  import {
    arenaContestantCounts,
    getRunAllBlockReason,
    getRunAllButtonTitle,
    isStaleArenaStreaming,
  } from "$lib/arenaRunAllGate.js";

  // ---------- State ----------
  let messagesA = $state([]);
  let messagesB = $state([]);
  let messagesC = $state([]);
  let messagesD = $state([]);
  let running = $state({ A: false, B: false, C: false, D: false });
  let liveTpsBySlot = $state({ A: null, B: null, C: null, D: null });
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
  /** When set (0–5), contestants are told to express numeric answers to this many decimal places; judge scores accordingly. null = not specified. */
  let arenaNumericPrecision = $state(
    (() => {
      if (typeof localStorage === "undefined") return null;
      const v = localStorage.getItem("arenaNumericPrecision");
      if (v === "" || v === null) return null;
      const n = parseInt(v, 10);
      return Number.isNaN(n) || n < 0 || n > 5 ? null : n;
    })(),
  );
  $effect(() => {
    if (typeof localStorage !== "undefined")
      localStorage.setItem("arenaNumericPrecision", arenaNumericPrecision != null ? String(arenaNumericPrecision) : "");
  });
  let questionIndex = $state(0);
  /** Arena Builder: generated question set (Phase 1). Only set after successful Build Arena. */
  let builtQuestionSet = $state(
    /** @type {{ questions: Array<{ id: string; text: string; category?: string; correct_answer?: string; grading_rubric?: string }> } | null} */ (null),
  );
  /** Metadata for audit: run_id, tool_calls, urls_accessed, timestamps. Set when Build Arena completes. */
  let builtQuestionSetMeta = $state(
    /** @type {null | { run_id: string; tool_calls: unknown[]; urls_accessed: string[]; timestamps: Record<string, number> }} */ (null),
  );
  /** Run metadata (in-memory only): reproducibility, audit. Set when Build Arena completes. */
  let arenaRunMetadata = $state(
    /** @type {null | { run_id: string; timestamp: number; judge_model: string; contestant_models: string[]; blind_review: boolean; deterministic_judge: boolean; builder_internet_enabled: boolean; question_count: number; categories: string[]; seed: string }} */ (null),
  );
  /** Builder config: categories and count. Persisted. */
  let arenaBuilderCategories = $state(
    typeof localStorage !== "undefined" ? (localStorage.getItem("arenaBuilderCategories") ?? "") : "",
  );
  let arenaBuilderQuestionCount = $state(
    Math.min(
      100,
      Math.max(1, parseInt(typeof localStorage !== "undefined" ? localStorage.getItem("arenaBuilderQuestionCount") ?? "10" : "10", 10) || 10),
    ),
  );
  /** Difficulty 1–5: 1 = easiest, 5 = frontier-model only. Persisted. */
  let arenaBuilderDifficultyLevel = $state(
    Math.min(5, Math.max(1, parseInt(typeof localStorage !== "undefined" ? localStorage.getItem("arenaBuilderDifficultyLevel") ?? "3" : "3", 10) || 3)),
  );
  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("arenaBuilderCategories", arenaBuilderCategories ?? "");
      localStorage.setItem("arenaBuilderQuestionCount", String(Math.min(100, Math.max(1, arenaBuilderQuestionCount || 1))));
      localStorage.setItem("arenaBuilderDifficultyLevel", String(Math.min(5, Math.max(1, arenaBuilderDifficultyLevel || 3))));
    }
  });
  /** Questions (with id, text, correct_answer) used by the bar and run. Only set after Build Arena. */
  const parsedQuestions = $derived(builtQuestionSet ? builtQuestionSet.questions : []);
  const parsedAnswers = $derived(parsedQuestions.map((q) => (q.correct_answer != null ? String(q.correct_answer) : "")));
  let buildArenaInProgress = $state(false);
  let buildArenaError = $state("");
  let loadQuestionsOpen = $state(false);
  let manualImportText = $state("");
  let manualImportError = $state("");

  const arenaModelsReady = $derived.by(() => {
    const n = $arenaPanelCount;
    const slots = [$dashboardModelA, $dashboardModelB, $dashboardModelC, $dashboardModelD].slice(0, n);
    return slots.every((id) => (id || "").trim().length > 0);
  });

  function openArenaSettings() {
    arenaSettingsCollapsed = false;
  }

  function applyManualImport() {
    manualImportError = "";
    let parsed = parseGeneratedQuestionSet(manualImportText);
    if (!parsed?.questions?.length) {
      const qa = parseQuestionsAndAnswers(manualImportText);
      if (qa.questions.length) parsed = qa;
    }
    if (!parsed?.questions?.length) {
      manualImportError =
        'Could not parse questions. Use JSON like [{"question":"…","answer":"…"}] or numbered Q&A text.';
      return;
    }
    const normalized = normalizeGeneratedQuestionSet(parsed);
    if (!normalized.questions.length) {
      manualImportError = "No valid questions found.";
      return;
    }
    builtQuestionSet = { questions: normalized.questions };
    builtQuestionSetMeta = null;
    arenaRunMetadata = null;
    questionIndex = 0;
    buildArenaError = "";
    loadQuestionsOpen = false;
    playClick();
  }

  async function buildArena() {
    buildArenaError = "";
    const contestantIds = [
      get(dashboardModelA),
      get(dashboardModelB),
      get(dashboardModelC),
      get(dashboardModelD),
    ].filter(Boolean);
    const pick = pickJudgeModel({
      userChoice: get(arenaScoringModelId)?.trim() || "",
      contestantIds,
      availableModels: get(models) || [],
    });
    if (pick.error || !pick.id) {
      buildArenaError = pick.error || "No judge model available. Select a judge model in Arena Settings.";
      return;
    }
    const judgeId = pick.id;
    const categories = (arenaBuilderCategories || "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const questionCount = Math.min(100, Math.max(1, arenaBuilderQuestionCount || 10));
    buildArenaInProgress = true;
    const runId = generateId();
    const timestamps = { build_start: Date.now() };
    let urlsAccessed = [];
    try {
      buildLoadingMessageIndex = Math.floor(Math.random() * ARENA_BUILD_LOADING_LINES.length);
      arenaTransitionPhase = "loading_judge";
      if (!isCloudModel(judgeId)) {
        try {
          if (!(await isLocalModelChatReady(judgeId))) {
            await loadModel(judgeId);
            const ready = await waitUntilLoaded(judgeId, {
              pollIntervalMs: 400,
              timeoutMs: 180000,
            });
            if (!ready) {
              buildArenaError = `Judge model "${judgeId}" did not finish loading. Pick another judge or wait and try again.`;
              return;
            }
          }
        } catch (loadErr) {
          buildArenaError =
            loadErr?.message ||
            `Could not load judge "${judgeId}". Pick a working local model or a cloud judge (DeepSeek).`;
          return;
        }
      } else {
        await new Promise((r) => setTimeout(r, 300));
      }
      let webContext = "";
      if (get(arenaBuilderInternetEnabled)) {
        timestamps.search_start = Date.now();
        const query =
          categories.length > 0
            ? `quiz questions and answers about ${categories.slice(0, 3).join(" ")}`
            : "quiz questions and answers general knowledge";
        try {
          const searchResult = await searchDuckDuckGo(query);
          webContext = formatSearchResultForChat(query, searchResult);
          if (searchResult.related?.length) {
            urlsAccessed = searchResult.related.map((r) => r.url).filter(Boolean);
          }
          if (searchResult.abstractUrl) urlsAccessed.unshift(searchResult.abstractUrl);
        } catch (e) {
          console.warn("[Arena Builder] Web search failed", e);
        }
        timestamps.search_end = Date.now();
      }
      timestamps.generation_start = Date.now();
      const difficultyLevel = Math.min(5, Math.max(1, arenaBuilderDifficultyLevel || 3));
      const messages = buildArenaQuestionGenerationPrompt({
        categories,
        questionCount,
        webContext,
        difficultyLevel,
      });
  const { content } = await requestChatCompletion({
        model: judgeId,
        messages,
        options: { temperature: 0.1, max_tokens: 8192, disable_thinking: true },
      });
      timestamps.generation_end = Date.now();
      let parsed = parseGeneratedQuestionSet(content);
      if (!parsed || parsed.questions.length === 0) {
        const repairMessages = buildArenaJsonRepairPrompt(content);
        const { content: repaired } = await requestChatCompletion({
          model: judgeId,
          messages: repairMessages,
          options: { temperature: 0.2, max_tokens: 8192, disable_thinking: true },
        });
        parsed = parseGeneratedQuestionSet(repaired);
      }
      if (!parsed || parsed.questions.length === 0) {
        const preview = String(content || "")
          .replace(/\s+/g, " ")
          .slice(0, 180);
        buildArenaError = preview
          ? `Judge did not return valid JSON (${preview}${String(content).length > 180 ? "…" : ""}). Try DeepSeek as judge, or Load questions as JSON.`
          : "Judge returned an empty reply (reasoning model used all tokens thinking). Try DeepSeek as judge, or Load questions.";
        return;
      }
      const normalized = normalizeGeneratedQuestionSet(parsed);
      const trimmed = normalized.questions.slice(0, questionCount);
      builtQuestionSet = { questions: trimmed };
      builtQuestionSetMeta = {
        run_id: runId,
        tool_calls: [],
        urls_accessed: urlsAccessed,
        timestamps: { ...timestamps },
      };
      const buildSeed = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      arenaRunMetadata = {
        run_id: runId,
        timestamp: Date.now(),
        judge_model: judgeId,
        contestant_models: contestantIds.filter(Boolean),
        blind_review: get(arenaBlindReview),
        deterministic_judge: get(arenaDeterministicJudge),
        builder_internet_enabled: get(arenaBuilderInternetEnabled),
        question_count: normalized.questions.length,
        categories: categories.slice(),
        seed: buildSeed,
      };
      questionIndex = 0;
    } catch (e) {
      buildArenaError = e?.message || "Build Arena failed.";
    } finally {
      buildArenaInProgress = false;
      arenaTransitionPhase = null;
    }
  }
  const currentQuestionItem = $derived(
    parsedQuestions.length > 0 ? parsedQuestions[questionIndex % parsedQuestions.length] : null,
  );
  /** Answer for the current question only (blank if none provided → judge uses web or own knowledge). */
  const currentQuestionAnswer = $derived(
    currentQuestionItem?.correct_answer != null ? String(currentQuestionItem.correct_answer).trim() : "",
  );
  const currentQuestionNum = $derived(
    parsedQuestions.length > 0 ? (questionIndex % parsedQuestions.length) + 1 : 0,
  );
  const currentQuestionTotal = $derived(parsedQuestions.length);
  const currentQuestionText = $derived(currentQuestionItem?.text != null ? String(currentQuestionItem.text).trim() : "");
  const currentQuestionId = $derived(currentQuestionItem?.id ?? null);
  /** Arena settings panel: docked right sidebar (collapsed = hidden, like left sidebar). */
  let arenaSettingsCollapsed = $state(
    typeof localStorage !== "undefined"
      ? (localStorage.getItem("arenaSettingsCollapsed") ?? "0") === "1"
      : false,
  );
  $effect(() => {
    if (typeof localStorage !== "undefined")
      localStorage.setItem("arenaSettingsCollapsed", arenaSettingsCollapsed ? "1" : "0");
  });
  // ---------- Web globe (same behavior as cockpit ChatInput globe) ----------
  let arenaWebWarmingUp = $state(false);
  let arenaWebWarmUpAttempted = $state(false);
  function runArenaWarmUp() {
    arenaWebWarmUpAttempted = true;
    arenaWebWarmingUp = true;
    webSearchConnected.set(false);
    warmUpSearchConnection()
      .then((ok) => {
        if (!ok && get(braveApiKey)?.trim()) return syncBraveKeyToProxy(get(braveApiKey)).then(() => warmUpSearchConnection());
        return ok;
      })
      .then((ok) => {
        arenaWebWarmingUp = false;
        webSearchConnected.set(ok);
      })
      .catch(() => {
        arenaWebWarmingUp = false;
        webSearchConnected.set(false);
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
  /** 1.0 = full width, 0 = closed. Driven by auto-close countdown. */
  let judgmentAutoCloseProgress = $state(1.0);
  /** When the drawer is hovered/focused, the countdown pauses. */
  let judgmentDrawerHovered = $state(false);

  $effect(() => {
    if (!judgmentPopup) { judgmentAutoCloseProgress = 1.0; return; }
    const DURATION = 7000;
    let elapsed = 0;
    let lastTick = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      if (!judgmentDrawerHovered) elapsed += now - lastTick;
      lastTick = now;
      judgmentAutoCloseProgress = Math.max(0, 1 - elapsed / DURATION);
      if (judgmentAutoCloseProgress <= 0) { clearInterval(id); judgmentPopup = null; }
    }, 50);
    return () => clearInterval(id);
  });

  /** Fisher–Yates shuffle of indices [0..n-1]. */
  function shuffleIndices(n) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function scrambleWittyMessages() {
    wittyOrderJudgeLoading = shuffleIndices(JUDGE_LOADING_LINES.length);
    wittyOrderJudgeWeb = shuffleIndices(JUDGE_WEB_LINES.length);
    wittyOrderLoadingModel = shuffleIndices(ARENA_LOADING_MODEL_LINES.length);
    wittyIndexJudgeLoading = 0;
    wittyIndexJudgeWeb = 0;
    wittyIndexLoadingModel = 0;
  }
  function getNextWittyJudgeLoading() {
    if (wittyOrderJudgeLoading.length === 0) scrambleWittyMessages();
    const arr = wittyOrderJudgeLoading;
    if (arr.length === 0) return 0;
    const i = arr[wittyIndexJudgeLoading];
    wittyIndexJudgeLoading = (wittyIndexJudgeLoading + 1) % arr.length;
    return i;
  }
  function getNextWittyJudgeWeb() {
    if (wittyOrderJudgeWeb.length === 0) scrambleWittyMessages();
    const arr = wittyOrderJudgeWeb;
    if (arr.length === 0) return 0;
    const i = arr[wittyIndexJudgeWeb];
    wittyIndexJudgeWeb = (wittyIndexJudgeWeb + 1) % arr.length;
    return i;
  }
  function getNextWittyLoadingModel() {
    if (wittyOrderLoadingModel.length === 0) scrambleWittyMessages();
    const arr = wittyOrderLoadingModel;
    if (arr.length === 0) return 0;
    const i = arr[wittyIndexLoadingModel];
    wittyIndexLoadingModel = (wittyIndexLoadingModel + 1) % arr.length;
    return i;
  }


  /** Transition: 'ejecting' | 'loading' | 'loading_judge' | 'judge_web' | 'scoring' (atom animation). */
  let arenaTransitionPhase = $state(
    /** @type {null | 'ejecting' | 'loading' | 'loading_judge' | 'judge_web' | 'scoring'} */ (null),
  );
  /** Index of the current witty "judge checking web" message (rotated each time we enter judge_web). */
  let judgeWebMessageIndex = $state(0);
  /** Index of the current witty "judge loading" message (rotated each time judge is loaded). */
  let judgeLoadingMessageIndex = $state(0);
  /** Index of the current witty "loading next model" message (rotated each time we load a contestant). */
  let loadingModelMessageIndex = $state(0);
  /** Index of the current witty "Build Arena" loading message (one per build). */
  let buildLoadingMessageIndex = $state(0);
  /** Shuffled orders for witty messages, cycled through each run so we see all of them. */
  let wittyOrderJudgeLoading = $state(/** @type {number[]} */ ([]));
  let wittyOrderJudgeWeb = $state(/** @type {number[]} */ ([]));
  let wittyOrderLoadingModel = $state(/** @type {number[]} */ ([]));
  let wittyIndexJudgeLoading = $state(0);
  let wittyIndexJudgeWeb = $state(0);
  let wittyIndexLoadingModel = $state(0);
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
  /** Judged questions kept in memory so the session PDF can be reprinted after panels clear. */
  let sessionRounds = $state([]);
  let reportHeadline = $state("");
  /** @type {null | { tied: boolean, slots: string[], points: number | null }} */
  let reportStanding = $state(null);
  let reportFilenameSaved = $state("");
  let reportBusy = $state(false);
  /** @type {Uint8Array | null} */
  let lastReportPdf = null;
  const scoreTotals = $derived(computeTotals(scoreHistory));
  const categoryRoll = $derived(contestCategoryTotals(scoreHistory));
  const contestComplete = $derived(
    parsedQuestions.length > 0 &&
      parsedQuestions.every((_, i) => scoreHistory.some((r) => r && r.questionIndex === i)),
  );
  const standingShort = $derived.by(() => {
    const standing = reportStanding;
    if (!standing || standing.points == null || !standing.slots?.length) return "";
    if (standing.tied) return `Tie ${standing.slots.join(" ")} · ${standing.points}`;
    return `${standing.slots[0]} leads · ${standing.points}`;
  });
  const categoryFinalLine = $derived.by(() => {
    if (!contestComplete || !categoryRoll.categories.length) return "";
    const slots = ["A", "B", "C", "D"].slice(0, $arenaPanelCount);
    return slots
      .filter((s) => scoreHistory.some((r) => typeof r.scores?.[s] === "number"))
      .map((s) => {
        const parts = categoryRoll.categories.map((cat) => `${cat} ${categoryRoll.bySlot[s]?.[cat] ?? 0}`);
        return `${s} ${categoryRoll.totals[s] ?? 0} (${parts.join(", ")})`;
      })
      .join(". ");
  });
  let judgmentInFlight = false;
  let lastJudgedRunId = /** @type {string | null} */ (null);

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

  function buildRunAllGateInput() {
    const { pickedCount, eligibleCount } = arenaContestantCounts({
      panelCount: get(arenaPanelCount),
      slotAIsJudge: get(arenaSlotAIsJudge),
      modelIdsBySlot: {
        A: get(dashboardModelA),
        B: get(dashboardModelB),
        C: get(dashboardModelC),
        D: get(dashboardModelD),
      },
      isEligible: isArenaModelEligible,
      isColumnVisible: readArenaColumnVisible,
    });
    return {
      questionCount: parsedQuestions.length,
      pickedCount,
      eligibleCount,
      isStreaming: get(isStreaming),
      runAllActive,
      anySlotRunning: running.A || running.B || running.C || running.D,
      arenaTransitionPhase,
      judgmentInFlight,
    };
  }

  const runAllGateInput = $derived.by(() => buildRunAllGateInput());
  const runAllButtonTitle = $derived(getRunAllButtonTitle(runAllGateInput));

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
  // Load persisted messages on mount. Leave the router child in VRAM so the
  // first Ask is a route, not a cold GGUF load.
  onMount(() => {
    loadArenaMessages();
  });
  // Save whenever messages change
  $effect(() => {
    messagesA;
    messagesB;
    messagesC;
    messagesD;
    saveArenaMessages();
  });

  // _REMOVED_JUDGE_WEB_LINES: dead code removed (migrated to arenaLogic.js).

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
    sessionRounds = [];
    reportHeadline = "";
    reportStanding = null;
    reportFilenameSaved = "";
    lastReportPdf = null;
    lastJudgedRunId = null;
    clearScoreHistory();
  }

  function currentModelBySlot() {
    return {
      A: get(dashboardModelA) || "",
      B: get(dashboardModelB) || "",
      C: get(dashboardModelC) || "",
      D: get(dashboardModelD) || "",
    };
  }

  function openReportFile() {
    if (reportFilenameSaved) {
      window.open(`/api/atom-arena-report?file=${encodeURIComponent(reportFilenameSaved)}`, "_blank", "noopener");
      return;
    }
    if (!lastReportPdf) return;
    const blob = new Blob([lastReportPdf], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
  }

  let reportLayout = $state(
    typeof localStorage !== "undefined" && localStorage.getItem("arenaReportLayout") === "long" ? "long" : "compact",
  );
  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("arenaReportLayout", reportLayout === "long" ? "long" : "compact");
    }
  });

  async function writeSessionReport(roundRecord = null) {
    if (!sessionRounds.length) return null;
    const report = buildArenaReport({
      rounds: sessionRounds,
      modelBySlot: currentModelBySlot(),
      generatedAt: new Date(),
      layout: reportLayout,
    });
    reportHeadline = report.winner.headline;
    reportStanding = {
      tied: !!report.winner.tied,
      slots: report.winner.slots || [],
      points: report.winner.points,
    };
    lastReportPdf = report.pdf;
    reportFilenameSaved = "";
    try {
      const res = await fetch("/api/atom-arena-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: report.filename,
          pdfBase64: bytesToBase64(report.pdf),
          ...(roundRecord ? { record: roundRecord } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok && json.filename) reportFilenameSaved = json.filename;
    } catch (_) {
      /* The button still opens the in-memory PDF. */
    }
    return report;
  }

  async function reprintReport() {
    if (reportBusy || !sessionRounds.length) return;
    reportBusy = true;
    try {
      await writeSessionReport();
      openReportFile();
    } finally {
      reportBusy = false;
    }
  }

  function rememberJudgedRound(qIdx, qText, roundScores, slotsWithResponses, category) {
    const entry = roundEntryFromMessages({
      questionIndex: qIdx,
      questionText: qText,
      slotsWithResponses,
      scores: roundScores,
      modelBySlot: currentModelBySlot(),
      catalog: get(modelPricingCatalog),
      category,
    });
    const next = sessionRounds.filter((r) => r.questionIndex !== qIdx);
    next.push(entry);
    next.sort((a, b) => (a.questionIndex ?? 0) - (b.questionIndex ?? 0));
    sessionRounds = next;
    const record = rowsForJudgedRound({
      entry,
      layout: reportLayout,
      arena: arenaPickMode === "anonymous" ? arenaBattle : "",
      startedAt: new Date().toISOString(),
      nameForId: modelDisplayName,
      tagsForId: (id) => {
        const row = prepareArenaModelList(get(models), get(modelPricingCatalog)).find((m) => m.id === id);
        return postHocScoreTags(id, get(modelPricingCatalog), row?.caps || null);
      },
    });
    void writeSessionReport(record);
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
    sessionRounds = [];
    reportHeadline = "";
    reportStanding = null;
    reportFilenameSaved = "";
    lastReportPdf = null;
    lastJudgedRunId = null;
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
  const ARENA_TIMEOUT_MS = 600000; // spec: timeout for judge model (10 min)

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
  let svgPictures = $state(
    typeof localStorage !== "undefined" && localStorage.getItem("arenaSvgPictures") === "1",
  );
  $effect(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem("arenaSvgPictures", svgPictures ? "1" : "0");
  });
  /** Empty means the composer goes to every visible contestant. A letter sends to that column only. */
  let directSlot = $state("");

  function storedPick(key, fallback) {
    if (typeof localStorage === "undefined") return fallback;
    const v = localStorage.getItem(key);
    return v == null || v === "" ? fallback : v;
  }
  let arenaPickMode = $state(storedPick("arenaPickMode", "anonymous") === "named" ? "named" : "anonymous");
  let arenaBattle = $state((() => {
    const v = storedPick("arenaBattle", "text");
    return v === "vision" || v === "code" ? v : "text";
  })());
  let arenaPickQuantity = $state(Math.min(4, Math.max(1, Number(storedPick("arenaPickQuantity", "2")) || 2)));
  let identityRevealed = $state(arenaPickMode === "named");
  let arenaLineupStatus = $state("");
  $effect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem("arenaPickMode", arenaPickMode);
    localStorage.setItem("arenaBattle", arenaBattle);
    localStorage.setItem("arenaPickQuantity", String(arenaPickQuantity));
  });
  const lineupPreview = $derived(pickArenaLineup({
    models: prepareArenaModelList($models, $modelPricingCatalog),
    catalog: $modelPricingCatalog,
    arena: arenaBattle,
    quantity: arenaPickQuantity,
    random: () => 0,
  }));
  const lineupPlan = $derived(arenaRunPlan({
    mode: arenaPickMode,
    arena: arenaBattle,
    quantity: arenaPickQuantity,
    available: lineupPreview.available,
  }));

  function setArenaPickMode(next) {
    arenaPickMode = next === "named" ? "named" : "anonymous";
    identityRevealed = arenaPickMode === "named";
    if (arenaPickMode === "anonymous") arenaLineupStatus = "";
  }

  function runClassLineup(quantity) {
    arenaPickQuantity = quantity;
    if (arenaPickMode !== "anonymous") return;
    if ($isStreaming || runAllActive) {
      chatError.set("A run is already going.");
      return;
    }
    const lineup = pickArenaLineup({
      models: prepareArenaModelList(get(models), get(modelPricingCatalog)),
      catalog: get(modelPricingCatalog),
      arena: arenaBattle,
      quantity,
    });
    arenaLineupStatus = arenaShortfallStatus(lineup);
    if (lineup.available <= 0) return;
    const stores = [dashboardModelA, dashboardModelB, dashboardModelC, dashboardModelD];
    for (let i = 0; i < 4; i++) stores[i].set(i < lineup.ids.length ? lineup.ids[i] : "");
    arenaPanelCount.set(lineup.quantity);
    identityRevealed = false;
    if (parsedQuestions.length === 0) {
      arenaLineupStatus = (arenaLineupStatus ? arenaLineupStatus + " " : "") + "Load questions, then Run all.";
      return;
    }
    runAllQuestions();
  }

  let flashNextTail = Promise.resolve();
  function enqueueFlashNext(modelId, work) {
    if (!isQwen38FlashNextSelection(modelId)) return work();
    const run = flashNextTail.then(work, work);
    flashNextTail = run.then(() => {}, () => {});
    return run;
  }

  function getSelectedArenaContestants() {
    const n = get(arenaPanelCount);
    const slotAIsJudge = get(arenaSlotAIsJudge);
    const slotsActive = [
      "A",
      ...(n >= 2 ? ["B"] : []),
      ...(n >= 3 ? ["C"] : []),
      ...(n >= 4 ? ["D"] : []),
    ];
    const picked = [
      { slot: "A", modelId: get(dashboardModelA) },
      { slot: "B", modelId: get(dashboardModelB) },
      { slot: "C", modelId: get(dashboardModelC) },
      { slot: "D", modelId: get(dashboardModelD) },
    ].filter(
      (s) =>
        s.modelId &&
        slotsActive.includes(s.slot) &&
        !(slotAIsJudge && s.slot === "A") &&
        readArenaColumnVisible(s.slot),
    );
    return picked.filter((s) => isArenaModelEligible(s.modelId));
  }

  async function loadContestantReady(modelId) {
    if (!modelId) return false;
    if (isCloudModel(modelId)) {
      arenaTransitionPhase = null;
      return true;
    }
    if (await isLocalModelChatReady(modelId)) {
      arenaTransitionPhase = null;
      return true;
    }
    loadingModelMessageIndex = getNextWittyLoadingModel();
    arenaTransitionPhase = "loading";
    try {
      await loadModel(modelId);
    } catch (loadErr) {
      const msg = String(loadErr?.message || loadErr || "");
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[Arena] loadModel:", modelId, msg);
      }
    }
    const ready = await waitUntilLoaded(modelId, {
      pollIntervalMs: 250,
      timeoutMs: 600000,
    });
    arenaTransitionPhase = null;
    if (!ready) {
      throw new Error(
        `Model "${modelId}" did not become ready (still loading or failed). Check llama-server.log.`,
      );
    }
    return true;
  }

  function applySnapshotMessages(snapshotsBySlot) {
    const map = snapshotsBySlot && typeof snapshotsBySlot === "object" ? snapshotsBySlot : {};
    for (const slot of ["A", "B", "C", "D"]) {
      const row = map[slot];
      setMessages(slot, row && Array.isArray(row.msgs) ? [...row.msgs] : []);
    }
  }

  async function runJudgmentWithSnapshots(snapshotsBySlot, qIdx) {
    const saved = {
      A: messagesA,
      B: messagesB,
      C: messagesC,
      D: messagesD,
    };
    const prevIndex = questionIndex;
    questionIndex = qIdx;
    applySnapshotMessages(snapshotsBySlot);
    try {
      await runJudgment();
    } finally {
      questionIndex = prevIndex;
      messagesA = saved.A;
      messagesB = saved.B;
      messagesC = saved.C;
      messagesD = saved.D;
    }
  }

  function applySvgAsk(question) {
    if (!svgPictures) return question;
    if (typeof question === "string") return question + "\n\n" + ARENA_SVG_ASK;
    if (Array.isArray(question)) {
      return question.map((part) =>
        part && part.type === "text" && typeof part.text === "string"
          ? { ...part, text: part.text + "\n\n" + ARENA_SVG_ASK }
          : part,
      );
    }
    return question;
  }

  async function sendToSlot(slot, modelId, question, displayQuestion, questionId = null) {
    return enqueueFlashNext(modelId, () => sendToSlotNow(slot, modelId, question, displayQuestion, questionId));
  }

  async function sendToSlotNow(slot, modelId, question, displayQuestion, questionId = null) {
    setRunning(slot, true);
    setSlotError(slot, "");

    const userMsgId = generateId();
    const userMsg = {
      id: userMsgId,
      role: "user",
      content: displayQuestion || question,
      createdAt: Date.now(),
    };
    if (questionId != null) userMsg.questionId = questionId;
    pushMessage(slot, userMsg);
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

    const startMs = performance.now();
    let fullContent = "";
    let usage = null;
    let elapsedMs = 0;
    let streamResult = null;
    lastSampleAt = Date.now();
    lastSampleTokens = 0;
    // Cloud (DeepSeek V4 flash) often reasons then answers past 2 minutes.
    const softTimeoutMs = isCloudModel(modelId)
      ? Math.max(120000, ($arenaRequestTimeoutSeconds || 180) * 1000)
      : 120000;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      aborters[slot] = controller;
      const timeoutId = setTimeout(() => controller.abort(), softTimeoutMs);
      try {
        streamResult = await streamChatCompletion({
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
            request_timeout_ms: $arenaRequestTimeoutSeconds * 1000,
            ...pickThinkingOptions(slotOpts),
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
            const liveStats = assistantStatsFromUsage(usage, fullContent);
            const estTokens = Math.max(1, liveStats.completion_tokens || Math.ceil(fullContent.length / 4) || 1);
            liveTokens.set(estTokens);
            const now = Date.now();
            if (now - lastSampleAt >= 1000) {
              const rate = (estTokens - lastSampleTokens) / ((now - lastSampleAt) / 1000);
              if (rate >= 0) {
                pushTokSample(rate);
                liveTpsBySlot = { ...liveTpsBySlot, [slot]: rate };
              }
              lastSampleAt = now;
              lastSampleTokens = estTokens;
            }
            updateMessage(slot, assistantMsgId, { content: fullContent, modelId, stats: liveStats });
          },
          onUsage(u) {
            usage = u;
            updateMessage(slot, assistantMsgId, {
              content: fullContent,
              modelId,
              stats: assistantStatsFromUsage(usage, fullContent),
            });
          },
        });
        elapsedMs = streamResult.elapsedMs ?? Math.round(performance.now() - startMs);
        if (streamResult.usage) usage = streamResult.usage;
        if (streamResult?.aborted && !fullContent.trim() && attempt === 1) {
          continue;
        }
        if ($settings.audio_enabled && !streamResult?.aborted)
          playComplete($settings.audio_volume);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        clearTimeout(timeoutId);
        if (err?.name === "AbortError") {
          // Never wipe a finished answer to retry. That is the spinner-after-answer bug.
          if (fullContent.trim()) {
            lastErr = null;
            break;
          }
          if (attempt === 1) continue;
          setSlotError(slot, "Timeout (no response after retry). Score: 0.");
          updateMessage(slot, assistantMsgId, { content: "", stats: null, modelId });
          return undefined;
        }
        setSlotError(slot, err?.message || "Failed to get response.");
        updateMessage(slot, assistantMsgId, { content: sanitizeContestantResponse(fullContent) || "", stats: null, modelId });
        return undefined;
      } finally {
        clearTimeout(timeoutId);
        liveTpsBySlot = { ...liveTpsBySlot, [slot]: null };
        if (aborters[slot] === controller) {
          setRunning(slot, false);
          aborters[slot] = null;
        }
      }
    }
    if (lastErr) {
      setSlotError(slot, lastErr?.message || "Failed to get response.");
      updateMessage(slot, assistantMsgId, { content: sanitizeContestantResponse(fullContent) || "", stats: null, modelId });
      return undefined;
    }

    // --- Sanitize: strip any judge-pattern lines the model may have hallucinated ---
    fullContent = sanitizeContestantResponse(fullContent);

    // --- Finalize stats ---
    const stats = assistantStatsFromUsage(usage, fullContent, {
      elapsed_ms: streamResult?.decodeMs > 0 ? streamResult.decodeMs : elapsedMs,
    });
    const tokenCount = stats.completion_tokens;
    stats.tok_per_sec = decodeTokPerSec({
      timings: streamResult?.timings,
      completionTokens: tokenCount,
      decodeMs: streamResult?.decodeMs,
      elapsedMs,
    });
    updateMessage(slot, assistantMsgId, {
      content: fullContent,
      stats,
      modelId,
    });
    if (get(arenaDebugMode) && typeof console !== "undefined" && console.log) {
      console.log("[Arena debug] slot response", {
        slot,
        prompt: typeof question === "string" ? question.slice(0, 200) : "(multimodal)",
        raw_response: fullContent.slice(0, 500) + (fullContent.length > 500 ? "…" : ""),
        latency: elapsedMs,
      });
    }
    return { latency_ms: elapsedMs, token_count: tokenCount, timestamp: Date.now() };
  }

  async function sendUserMessage(text, imageDataUrls = [], questionId = null, sendOpts = {}) {
    const internalRun = sendOpts.internalRun === true;
    const onlySlot = sendOpts.onlySlot ? String(sendOpts.onlySlot) : null;
    const skipJudgment = sendOpts.skipJudgment === true;
    const assumeModelLoaded = sendOpts.assumeModelLoaded === true;
    if (!text || !String(text).trim() || (!internalRun && $isStreaming)) return;
    chatError.set(null);
    if ((imageDataUrls?.length > 0)) {
      const slotModels = [$dashboardModelA, $dashboardModelB, $dashboardModelC, $dashboardModelD].filter(Boolean);
      const listed = $models;
      const catalog = $modelPricingCatalog;
      let nonVision = null;
      for (const id of slotModels) {
        let vision = listedModelCaps(id, listed, catalog).vision;
        if (!vision && isQwen38FlashNextSelection(id)) vision = await flashNextHasVision();
        if (!vision) {
          nonVision = id;
          break;
        }
      }
      if (nonVision) {
        chatError.set(`"${nonVision}" does not support image input. Switch to a vision-capable model.`);
        return;
      }
    }

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
    const slotAIsJudge = get(arenaSlotAIsJudge);
    const slotsActive = [
      "A",
      ...(n >= 2 ? ["B"] : []),
      ...(n >= 3 ? ["C"] : []),
      ...(n >= 4 ? ["D"] : []),
    ];
    let picked = [
      { slot: "A", modelId: $dashboardModelA },
      { slot: "B", modelId: $dashboardModelB },
      { slot: "C", modelId: $dashboardModelC },
      { slot: "D", modelId: $dashboardModelD },
    ].filter((s) => s.modelId && slotsActive.includes(s.slot) && !(slotAIsJudge && s.slot === "A") && readArenaColumnVisible(s.slot));
    let selected = picked.filter((s) => isArenaModelEligible(s.modelId));
    if (onlySlot) {
      selected = selected.filter((s) => s.slot === onlySlot);
    }

    if (!selected.length) {
      chatError.set(
        picked.length
          ? "The selected cloud providers are not funded for this startup, so they are excluded from testing."
          : "Select at least one visible model (A–D) before sending. A hidden column is skipped.",
      );
      return;
    }

    runId += 1;
    const currentRun = runId;
    liveTokens.set(0);
    if (arenaPickMode === "anonymous") identityRevealed = false;
    if (!internalRun) isStreaming.set(true);
    try {
      let rulesPrefix = (typeof contestRules === "string"
        ? contestRules
        : ""
      ).trim()
        ? contestRules.trim() + "\n\n---\n\n"
        : "";
      if (arenaNumericPrecision != null) {
        const precisionLine =
          arenaNumericPrecision === 0
            ? "Numeric answers must be expressed as integers (no decimal places)."
            : `Numeric answers must be expressed to exactly ${arenaNumericPrecision} decimal place(s).`;
        rulesPrefix = rulesPrefix ? rulesPrefix + precisionLine + "\n\n" : precisionLine + "\n\n---\n\n";
      }
      const textWithRules = rulesPrefix + effectiveText;
      const urls = Array.isArray(imageDataUrls) ? imageDataUrls : [];
      const needResize =
        urls.length > 0 &&
        !selected.every((s) => shouldSkipImageResizeForVision(s.modelId));
      const resizeFor =
        selected.find((s) => /flash-next/i.test(String(s.modelId || "")))?.modelId ||
        selected[0]?.modelId ||
        "";
      const urlsForApi = urls.length
        ? needResize
          ? await resizeImageDataUrlsForVision(urls, resizeFor)
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
      const runSeed = arenaRunMetadata?.seed ?? (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
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
      scrambleWittyMessages();

      /* Clear slot messages so old responses/judge text don't leak into new run. */
      if (!onlySlot) {
        messagesA = [];
        messagesB = [];
        messagesC = [];
        messagesD = [];
      }

      let completedCount = 0;
      let failedSlots = [];
      const maxAttempts = 2;
      for (let i = 0; i < selected.length; i++) {
        if (runId !== currentRun) break;
        const s = selected[i];
        let slotOk = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (runId !== currentRun) break;
          setMessages(s.slot, []);
          setSlotError(s.slot, "");
          try {
            if (!assumeModelLoaded) {
              await loadContestantReady(s.modelId);
            }
            if (runId !== currentRun) break;
            const metrics = await sendToSlot(
              s.slot,
              s.modelId,
              applySvgAsk(content),
              displayContent,
              questionId,
            );
            if (!metrics) {
              if (attempt === maxAttempts) {
                failedSlots.push(s.slot);
                const hasText = getMessages(s.slot).some(
                  (m) =>
                    m.role === "assistant" &&
                    contentToText(m.content || "").trim(),
                );
                if (!hasText) {
                  setSlotError(s.slot, "No response after retries.");
                }
              }
              continue;
            }
            slotOk = true;
            completedCount++;
            if (arenaCurrentRunMeta) {
              const msgs = getMessages(s.slot);
              const lastAsst = [...msgs]
                .reverse()
                .find((m) => m.role === "assistant");
              arenaCurrentRunMeta.responses[s.slot] = {
                model_id: s.modelId,
                prompt: effectiveText,
                raw_response: lastAsst ? contentToText(lastAsst.content) : "",
                latency_ms: metrics.latency_ms,
                token_count: metrics.token_count,
                timestamp: metrics.timestamp,
              };
            }
            break;
          } catch (slotErr) {
            if (attempt === maxAttempts) {
              failedSlots.push(s.slot);
              setSlotError(
                s.slot,
                slotErr?.message || "Failed to get response.",
              );
            }
          }
        }
        if (!slotOk && !failedSlots.includes(s.slot)) failedSlots.push(s.slot);
      }
      /* All contestants have run. Score once here — Run All must not call runJudgment again. */
      if (!skipJudgment && runId === currentRun) {
        if (!internalRun) {
          isStreaming.set(false);
          liveTokens.set(null);
          liveTokPerSec.set(null);
        }
        judgeLoadingMessageIndex = getNextWittyJudgeLoading();
        arenaTransitionPhase = "loading_judge";
        await runJudgment();
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
      /* Don't clear transition when judge phase is starting (runJudgment will clear it). */
      if (arenaTransitionPhase !== "loading_judge") arenaTransitionPhase = null;
      if (!internalRun) {
        isStreaming.set(false);
        liveTokens.set(null);
        liveTokPerSec.set(null);
        if (arenaPickMode === "anonymous") identityRevealed = true;
      }
    }
  }

  async function sendDirectQuestion(slot, text) {
    const question = String(text || "").trim();
    if (!question) return;
    if ($isStreaming) {
      chatError.set("A run is already going. Wait for it to finish, then ask that column.");
      return;
    }
    const modelId = { A: $dashboardModelA, B: $dashboardModelB, C: $dashboardModelC, D: $dashboardModelD }[slot];
    if (!modelId) {
      chatError.set("Choose a model in column " + slot + " first.");
      return;
    }
    chatError.set(null);
    if (arenaPickMode === "anonymous") identityRevealed = false;
    isStreaming.set(true);
    try {
      setMessages(slot, []);
      await sendToSlot(slot, modelId, applySvgAsk(question), question, null);
    } catch (e) {
      chatError.set(e?.message || "That column did not answer.");
    } finally {
      isStreaming.set(false);
      setRunning(slot, false);
      if (arenaPickMode === "anonymous") identityRevealed = true;
    }
  }

  function onComposerSend(text, imageDataUrls = []) {
    if (directSlot) return sendDirectQuestion(directSlot, text);
    return sendUserMessage(text, imageDataUrls);
  }

  function stopAll() {
    runId += 1;
    arenaTransitionPhase = null;
    // Cancel Run All if active (prevents zombie question loops)
    runAllActive = false;
    runAllProgress = { current: 0, total: 0 };
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
    // Clear any lingering slot errors so UI doesn't show stale errors
    slotErrors = { A: "", B: "", C: "", D: "" };
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
    const item = questions[idx];
    const toSend = item?.text != null ? String(item.text).trim() : "";
    if (!toSend) return;
    messagesA = [];
    messagesB = [];
    messagesC = [];
    messagesD = [];
    chatError.set(null);
    if ($settings.audio_enabled && $settings.audio_clicks)
      playClick($settings.audio_volume);
    sendUserMessage(toSend, [], item?.id ?? null).catch((e) => {
      chatError.set(e?.message || "Failed to send question.");
    });
  }

  /** Next: advance to the next question AND immediately send it. One-click to keep the competition moving. */
  function askNextQuestion() {
    if ($isStreaming) return;
    const questions = parsedQuestions;
    if (questions.length === 0) return;
    questionIndex = (questionIndex + 1) % questions.length;
    const idx = questionIndex % questions.length;
    const item = questions[idx];
    const toSend = item?.text != null ? String(item.text).trim() : "";
    if (!toSend) return;
    messagesA = [];
    messagesB = [];
    messagesC = [];
    messagesD = [];
    chatError.set(null);
    if ($settings.audio_enabled && $settings.audio_clicks)
      playClick($settings.audio_volume);
    sendUserMessage(toSend, [], item?.id ?? null).catch((e) => {
      chatError.set(e?.message || "Failed to send question.");
    });
  }

  /** Run All: iterate through all questions, send each, then run automated scoring after each. */
  async function runAllQuestions() {
    if (runAllActive) return;

    let gate = buildRunAllGateInput();
    if (isStaleArenaStreaming(gate)) {
      stopAll();
      gate = buildRunAllGateInput();
      chatError.set("Cleared a stuck run state. Confirm Run all to continue.");
    }

    const block = getRunAllBlockReason(gate);
    if (block) {
      chatError.set(block);
      return;
    }

    const questions = parsedQuestions;
    if (questions.length === 0) return;
    const sequential = get(arenaSequentialByContestant);
    const contestants = getSelectedArenaContestants();
    if (!contestants.length) {
      chatError.set("Select at least one visible model (A–D) before Run all.");
      return;
    }
    const hasJudgeModel = get(models).length > 0; // judge will be auto-selected from non-contestants
    const orderNote = sequential
      ? " Models run one at a time (each answers every question before the next loads)."
      : "";
    const ok = await confirm({
      title: "Run all questions",
      message: `This will run ${questions.length} question${questions.length > 1 ? "s" : ""} in order${hasJudgeModel ? " with automated scoring after each" : ""}.${orderNote} This may take a while.`,
      confirmLabel: "Run all",
      cancelLabel: "Cancel",
      danger: false,
    });
    if (!ok) return;
    chatError.set(null);
    runAllActive = true;
    runAllProgress = { current: 0, total: questions.length };
    isStreaming.set(true);
    if (arenaPickMode === "anonymous") identityRevealed = false;
    try {
      if (!sequential) {
        for (let i = 0; i < questions.length; i++) {
          if (!runAllActive) break; // user cancelled
          questionIndex = i;
          runAllProgress = { current: i + 1, total: questions.length };
          const item = questions[i];
          const toSend = item?.text != null ? String(item.text).trim() : "";
          if (!toSend) continue;
          messagesA = [];
          messagesB = [];
          messagesC = [];
          messagesD = [];
          chatError.set(null);
          try {
            await sendUserMessage(toSend, [], item?.id ?? null);
          } catch (e) {
            chatError.set(e?.message || `Failed on question ${i + 1}.`);
            continue;
          }
          // sendUserMessage already waited for contestants and ran judgment once.
        }
      } else {
        const requiredSlots = contestants.map((c) => c.slot);
        /** @type {Record<number, Record<string, { slot: string, msgs: object[] }>>} */
        const snapshotsByQuestion = {};
        const steps = buildArenaRunAllSteps({
          sequentialByContestant: true,
          questionCount: questions.length,
          contestants,
        });
        let stepNum = 0;
        for (const step of steps) {
          if (!runAllActive || step.kind !== "contestant_answer") break;
          stepNum += 1;
          const i = step.questionIndex;
          questionIndex = i;
          runAllProgress = { current: i + 1, total: questions.length };
          const contestant = contestants.find((c) => c.slot === step.slot);
          if (!contestant) continue;
          const item = questions[i];
          const toSend = item?.text != null ? String(item.text).trim() : "";
          if (!toSend) continue;
          chatError.set(null);
          try {
            const isFirstQuestionForContestant =
              !steps.some(
                (s, idx) =>
                  idx < stepNum - 1 &&
                  s.kind === "contestant_answer" &&
                  s.slot === step.slot,
              );
            if (isFirstQuestionForContestant) {
              await loadContestantReady(contestant.modelId);
            }
            setMessages(step.slot, []);
            await sendUserMessage(toSend, [], item?.id ?? null, {
              internalRun: true,
              onlySlot: step.slot,
              skipJudgment: true,
              assumeModelLoaded: true,
            });
            if (!snapshotsByQuestion[i]) snapshotsByQuestion[i] = {};
            snapshotsByQuestion[i][step.slot] = {
              slot: step.slot,
              msgs: [...getMessages(step.slot)],
            };
            if (isArenaQuestionRoundComplete(snapshotsByQuestion[i], requiredSlots)) {
              await runJudgmentWithSnapshots(snapshotsByQuestion[i], i);
            }
          } catch (e) {
            chatError.set(e?.message || `Failed on question ${i + 1} (${step.slot}).`);
          }
        }
      }
    } finally {
      runAllActive = false;
      runAllProgress = { current: 0, total: 0 };
      isStreaming.set(false);
      liveTokens.set(null);
      liveTokPerSec.set(null);
      arenaTransitionPhase = null;
      if (arenaPickMode === "anonymous") identityRevealed = true;
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
      ejectAllModels();
    }
  }

  // ---------- Automated judgment: eject contestants → load scoring model → evaluate against answer key → show popup ----------
  async function runJudgment() {
    const thisRunId = arenaCurrentRunMeta?.run_id || null;
    if (thisRunId && lastJudgedRunId === thisRunId) return;
    if (judgmentInFlight) return;
    judgmentInFlight = true;
    try {
      await runJudgmentBody();
    } finally {
      judgmentInFlight = false;
    }
  }

  function svgToPngDataUrl(svg) {
    return new Promise((resolve) => {
      if (typeof document === "undefined" || !svg) {
        resolve(null);
        return;
      }
      let markup = svg;
      if (!/\bwidth\s*=/.test(markup)) {
        markup = markup.replace(/<svg/i, '<svg width="240" height="140"');
      }
      const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      const done = (png) => {
        URL.revokeObjectURL(url);
        resolve(png);
      };
      img.onload = () => {
        const w = img.naturalWidth || 240;
        const h = img.naturalHeight || 140;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          done(null);
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        try {
          done(canvas.toDataURL("image/png"));
        } catch (_) {
          done(null);
        }
      };
      img.onerror = () => done(null);
      img.src = url;
    });
  }

  async function picturesForJudge(slots) {
    const out = {};
    for (const { slot, msgs } of slots) {
      const last = [...(msgs || [])].reverse().find((m) => m?.role === "assistant");
      if (!last) continue;
      const urls = [];
      if (Array.isArray(last.content)) {
        for (const part of last.content) {
          const url = part?.image_url?.url;
          if (part?.type === "image_url" && url) urls.push(url);
        }
      }
      const svg = extractSvgMarkup(contentToText(last.content));
      if (svg) {
        const png = await svgToPngDataUrl(svg);
        if (png) urls.push(png);
      }
      if (urls.length) out[slot] = urls;
    }
    return out;
  }

  async function runJudgmentBody() {
    if ($isStreaming && !runAllActive) return;
    const n = get(arenaPanelCount);
    const slotAIsJudge = get(arenaSlotAIsJudge);
    /** Contestant model IDs (when Slot A is judge, only B/C/D are contestants so A can be used as judge). */
    const contestantIds = [
      slotAIsJudge ? null : get(dashboardModelA),
      n >= 2 ? get(dashboardModelB) : null,
      n >= 3 ? get(dashboardModelC) : null,
      n >= 4 ? get(dashboardModelD) : null,
    ].filter(Boolean);
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
    const needsVision = slotsNeedVision(slotsWithResponses);
    const slotAId = get(dashboardModelA);
    const slotACanSee = !!(slotAId && listedModelCaps(slotAId, get(models), get(modelPricingCatalog)).vision);
    let judgeId = null;
    let judgeError = "";
    if (slotAIsJudge && slotAId && (!needsVision || slotACanSee)) {
      judgeId = slotAId;
    } else {
      const pick = pickJudgeModel({
        userChoice: get(arenaScoringModelId)?.trim() || "",
        contestantIds,
        availableModels: get(models),
        requireVision: needsVision,
      });
      if (pick.id) {
        judgeId = pick.id;
        if (pick.fallback && typeof console !== "undefined") {
          console.log("[Arena] Judge auto-selected:", pick.id, needsVision ? "(picture round)" : "(user choice was a contestant or unset)");
        }
      } else if (!needsVision && contestantIds.length > 0) {
        /* Text round only: a contestant can still read the reply. A picture round must not. */
        judgeId = contestantIds[0];
        if (typeof console !== "undefined" && console.log) {
          console.log("[Arena] Using first contestant as judge (no other model available).");
        }
      } else {
        judgeError = pick.error || "";
      }
    }
    if (!judgeId) {
      arenaTransitionPhase = null;
      chatError.set(
        judgeError ||
          "No judge model available. Load a model in LM Studio (or add a cloud API key) that is not in any Arena slot, or enable \"Slot A is judge\" and set Slot A."
      );
      return;
    }
    if (arenaCurrentRunMeta) arenaCurrentRunMeta.judge_model = judgeId;
    const feedback =
      typeof judgeFeedback === "string" ? judgeFeedback.trim() : "";
    const picturesBySlot = needsVision ? await picturesForJudge(slotsWithResponses) : {};
    try {
      judgeLoadingMessageIndex = getNextWittyJudgeLoading();
      arenaTransitionPhase = "loading_judge";
      if (!isCloudModel(judgeId)) {
        try {
          if (!(await isLocalModelChatReady(judgeId))) {
            await loadModel(judgeId);
            await waitUntilLoaded(judgeId, {
              pollIntervalMs: 500,
              timeoutMs: 600000,
            });
          }
        } catch (_) {}
      }
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
      judgeWebMessageIndex = getNextWittyJudgeWeb();
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
    if (get(arenaDebugMode) && shuffleRandom && typeof console !== "undefined" && console.log) {
      console.log("[Arena debug] shuffle_order seed", { seed: arenaCurrentRunMeta?.seed });
    }
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
            numericPrecision: arenaNumericPrecision,
            picturesBySlot,
          });
          responseOrder = out.responseOrder;
          if (get(arenaDebugMode) && typeof console !== "undefined" && console.log) {
            console.log("[Arena debug] shuffle_order", { responseOrder });
          }
          return { messages: out.messages };
        })()
      : buildJudgePrompt({
          slotsWithResponses,
          answerKeyTrimmed,
          judgeWebContext,
          promptText,
          judgeFeedback: feedback,
          judgeInstructions,
          numericPrecision: arenaNumericPrecision,
          picturesBySlot,
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
          request_timeout_ms: $arenaRequestTimeoutSeconds * 1000,
          ...pickThinkingOptions(judgeOpts),
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
      if (get(arenaDebugMode) && typeof console !== "undefined" && console.log) {
        console.log("[Arena debug] judge_raw_output", { judge_raw_output: fullContent });
      }
      let roundScores;
      let displayExplanation = fullContent;
      let popupExplanations = /** @type {Record<string, string> | undefined} */ (undefined);
      if (useBlindReview && responseOrder) {
        const blindMerged = parseBlindJudgeScoresMerged(fullContent, responseOrder);
        const blind = parseBlindJudgeScores(fullContent, responseOrder);
        const blindLenient = parseBlindJudgeScoresLenient(fullContent, responseOrder);
        roundScores = blindMerged.scores;
        popupExplanations = { ...blindLenient.explanations, ...blind.explanations };
        const lines = ["A", "B", "C", "D"]
          .filter((slot) => roundScores[slot] !== undefined)
          .map((slot) => `Model ${slot}: ${roundScores[slot]}/10 - ${(blind.explanations[slot] || "").trim() || "—"}`);
        displayExplanation = lines.join("\n");
      } else {
        roundScores = parseJudgeScoresMerged(fullContent).scores;
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
          const qText = (parsedQuestions[qIdx]?.text != null ? String(parsedQuestions[qIdx].text) : null) || "(free-form prompt)";
          const qCat = parsedQuestions[qIdx]?.category;
          const category = typeof qCat === "string" ? qCat.trim() : "";
          scoreHistory = addScoreRound(scoreHistory, qIdx, qText, roundScores, category);
          arenaScores = computeTotals(scoreHistory);
          rememberJudgedRound(qIdx, qText, roundScores, slotsWithResponses, category);
          if (arenaCurrentRunMeta?.run_id) lastJudgedRunId = arenaCurrentRunMeta.run_id;
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
          request_timeout_ms: $arenaRequestTimeoutSeconds * 1000,
          ...pickThinkingOptions(askJudgeOpts),
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
      liveTps: liveTpsBySlot[slot],
      score: arenaScores[slot] ?? 0,
      standingLabel: arenaStandingLabel(slot, arenaScores),
      effectiveSettings: effectiveSettings[slot],
      accentColor: SLOT_COLORS[slot],
      showScore: true,
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
  <!-- One toolbar: run the round, then how the match is set up. -->
  <div class="arena-chrome">
  <ArenaControlBar
    currentQuestionNum={currentQuestionNum}
    currentQuestionTotal={currentQuestionTotal}
    parsedQuestions={parsedQuestions}
    builtQuestionCount={builtQuestionSet ? builtQuestionSet.questions.length : 0}
    buildArenaInProgress={buildArenaInProgress}
    buildArenaError={buildArenaError}
    onBuildArena={buildArena}
    onOpenLoadModal={() => { loadQuestionsOpen = true; }}
    runAllActive={runAllActive}
    runAllProgress={runAllProgress}
    sequentialByContestant={$arenaSequentialByContestant}
    sequentialToggleDisabled={runAllActive || $isStreaming}
    onToggleSequential={(on) => {
      if (runAllActive || $isStreaming) return;
      arenaSequentialByContestant.set(!!on);
    }}
    arenaWebWarmingUp={arenaWebWarmingUp}
    arenaWebWarmUpAttempted={arenaWebWarmUpAttempted}
    resetWebWarmUpAttempted={() => { arenaWebWarmUpAttempted = false; }}
    prevQuestion={prevQuestion}
    jumpToQuestion={jumpToQuestion}
    advanceQuestionIndex={advanceQuestionIndex}
    askCurrentQuestion={askCurrentQuestion}
    askNextQuestion={askNextQuestion}
    runAllQuestions={runAllQuestions}
    runAllButtonTitle={runAllButtonTitle}
    stopRunAll={stopRunAll}
    runArenaWarmUp={runArenaWarmUp}
    startOver={startOver}
  />
  <span class="arena-chrome-rule" aria-hidden="true"></span>
  <ArenaLineup
    mode={arenaPickMode}
    arena={arenaBattle}
    quantity={arenaPickQuantity}
    plan={lineupPlan}
    status={arenaLineupStatus}
    onMode={setArenaPickMode}
    onArena={(id) => { arenaBattle = id === "vision" || id === "code" ? id : "text"; arenaLineupStatus = ""; }}
    onQuantity={runClassLineup}
  />
  <div class="arena-session-end">
  <ProviderCheckList />
  {#if reportHeadline || sessionRounds.length > 0}
  <div class="arena-report-inline" role="status" aria-live="polite">
    {#if standingShort}
      <span class="arena-standing" title={[reportHeadline, categoryFinalLine].filter(Boolean).join("\n")}>{standingShort}</span>
    {:else if reportHeadline}
      <span class="arena-standing" title={reportHeadline}>{reportHeadline}</span>
    {/if}
    <div class="arena-seg" role="group" aria-label="Report length">
      <button type="button" aria-pressed={reportLayout === 'compact'} onclick={() => (reportLayout = 'compact')} title="Compact report">Compact</button>
      <button type="button" aria-pressed={reportLayout === 'long'} onclick={() => (reportLayout = 'long')} title="Long report">Long</button>
    </div>
    <button
      type="button"
      class="arena-report-btn"
      disabled={reportBusy || sessionRounds.length === 0}
      onclick={reprintReport}
    >{reportBusy ? "Writing…" : "Report"}</button>
  </div>
  {/if}
  </div>
  <ArenaLoadQuestionsModal
    bind:open={loadQuestionsOpen}
    bind:manualImportText
    {manualImportError}
    {buildArenaInProgress}
    onApplyImport={applyManualImport}
    onBuildArena={() => { openArenaSettings(); buildArena(); }}
    onOpenSettings={openArenaSettings}
  />
  </div>
  {#if runAllActive}
    <div class="arena-runall-progress shrink-0" role="progressbar" aria-valuenow={runAllProgress.current} aria-valuemin={0} aria-valuemax={runAllProgress.total} aria-label="Run All progress">
      <div class="arena-runall-progress-fill" style="width: {runAllProgress.total > 0 ? (runAllProgress.current / runAllProgress.total) * 100 : 0}%"></div>
    </div>
  {/if}

  <!-- === Main content + docked right settings panel === -->
  <div class="flex-1 min-h-0 flex relative">
  <!-- Main content column -->
  <div class="flex-1 min-w-0 flex flex-col min-h-0">

  <!-- === Sticky question text bar (always visible above panels) === -->
  {#if currentQuestionTotal > 0 && currentQuestionText}
    <div class="arena-question-bar shrink-0" aria-live="polite">
      <p class="arena-question-read" title={currentQuestionText}>
        <span class="arena-question-num">Q{currentQuestionNum}</span>
        <span class="arena-question-text" class:arena-question-clamp={currentQuestionText.length > 220}>{currentQuestionText}</span>
      </p>
    </div>
  {/if}

  <!-- === Response panels A–D (resizable) === -->
  <div
    bind:this={gridEl}
    class="flex-1 min-h-0 grid gap-3 atom-layout-transition relative grid-rows-[minmax(0,1fr)]"
    style="grid-template-columns: {responsiveGridCols}; padding: 1rem; padding-right: {arenaSettingsCollapsed ? '2.5rem' : '1rem'};"
  >
    {#each slotData as data, i (data.slot)}
      <ArenaPanel
        slot={data.slot}
        modelId={data.modelId}
        messages={data.messages}
        running={data.running}
        slotError={data.slotError}
        tps={data.tps}
        liveTps={data.liveTps}
        score={data.score}
        standingLabel={data.standingLabel}
        effectiveSettings={data.effectiveSettings}
        optionsOpen={optionsOpenSlot === data.slot}
        onToggleOptions={() => (optionsOpenSlot = optionsOpenSlot === data.slot ? null : data.slot)}
        onClear={() => setMessages(data.slot, [])}
        onScrollRef={(el) => {
          if (data.slot === "A") arenaScrollA = el;
          else if (data.slot === "B") arenaScrollB = el;
          else if (data.slot === "C") arenaScrollC = el;
          else arenaScrollD = el;
        }}
        accentColor={data.accentColor}
        showScore={data.showScore}
        loadStatus={null}
        currentQuestionText={currentQuestionText}
        currentQuestionId={currentQuestionId}
        svgMode={svgPictures}
        concealIdentity={arenaPickMode === "anonymous" && !identityRevealed}
      />
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
      class="shrink-0 flex flex-col items-center justify-center gap-1 py-3 px-4 rounded-xl mx-3 mb-2"
      style="background: color-mix(in srgb, var(--ui-accent) 6%, var(--ui-bg-main)); color: var(--ui-text-primary);"
      role="status"
      aria-live="polite"
    >
      <div class="flex items-center gap-2">
        <ThinkingAtom size={22} />
        <span class="text-sm font-medium">
          {#if arenaTransitionPhase === "loading_judge"}
            {#if buildArenaInProgress}
              {ARENA_BUILD_LOADING_LINES[buildLoadingMessageIndex].main}
            {:else}
              {JUDGE_LOADING_LINES[judgeLoadingMessageIndex].main}
            {/if}
          {:else if arenaTransitionPhase === "judge_web"}
            {JUDGE_WEB_LINES[judgeWebMessageIndex].main}
          {:else if arenaTransitionPhase === "ejecting"}
            Ejecting…
          {:else if arenaTransitionPhase === "scoring"}
            Scoring answers…
          {:else if arenaTransitionPhase === "loading"}
            {ARENA_LOADING_MODEL_LINES[loadingModelMessageIndex].main}
          {:else}
            Loading…
          {/if}
        </span>
      </div>
      {#if arenaTransitionPhase === "loading_judge"}
        <span
          class="text-xs opacity-80"
          style="color: var(--ui-text-secondary);"
          >{buildArenaInProgress ? ARENA_BUILD_LOADING_LINES[buildLoadingMessageIndex].sub : JUDGE_LOADING_LINES[judgeLoadingMessageIndex].sub}</span
        >
      {:else if arenaTransitionPhase === "judge_web"}
        <span
          class="text-xs opacity-80"
          style="color: var(--ui-text-secondary);"
          >{JUDGE_WEB_LINES[judgeWebMessageIndex].sub}</span
        >
      {:else if arenaTransitionPhase === "loading"}
        <span
          class="text-xs opacity-80"
          style="color: var(--ui-text-secondary);"
          >{ARENA_LOADING_MODEL_LINES[loadingModelMessageIndex].sub}</span
        >
      {/if}
    </div>
  {/if}

  <!-- Build error: shown where the loading banner was, so a failed Build is never silent -->
  {#if buildArenaError && !arenaTransitionPhase}
    <div
      class="shrink-0 flex items-start justify-between gap-3 py-2.5 px-4 rounded-xl mx-3 mb-2"
      role="alert"
      style="background: color-mix(in srgb, var(--ui-accent-hot, #dc2626) 10%, var(--ui-bg-main)); border: 1px solid color-mix(in srgb, var(--ui-accent-hot, #dc2626) 35%, transparent); color: var(--ui-text-primary);"
    >
      <div class="text-sm min-w-0">
        <span class="font-semibold" style="color: var(--ui-accent-hot, #dc2626);">Build failed:</span>
        <span class="break-words"> {buildArenaError}</span>
      </div>
      <button
        type="button"
        class="shrink-0 p-1 rounded transition-opacity hover:opacity-80"
        style="color: var(--ui-text-secondary);"
        onclick={() => (buildArenaError = "")}
        aria-label="Dismiss build error"
      >×</button>
    </div>
  {/if}

  <!-- Minimal footer: chat error + send. Hidden for the whole run, including scoring. -->
  {#if $chatError || !(runAllActive || $isStreaming || arenaTransitionPhase)}
  <div
    class="shrink-0 px-4 py-3"
    style="background: color-mix(in srgb, var(--ui-border) 6%, var(--ui-bg-sidebar));"
  >
    {#if $chatError}
      <div
        class="mb-2 px-3 py-2 rounded-xl text-sm flex items-center justify-between gap-2"
        style="background: color-mix(in srgb, var(--ui-accent-hot, #dc2626) 12%, transparent); color: var(--ui-accent-hot, #dc2626);"
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
    {#if !(runAllActive || $isStreaming || arenaTransitionPhase)}
    <section class="max-w-2xl mx-auto w-full" aria-label="Send prompt">
      <div class="flex flex-wrap items-center gap-3 mb-2">
        <label class="flex items-center gap-1.5 text-xs font-semibold" style="color: var(--ui-text-primary);">
          <input type="checkbox" bind:checked={svgPictures} />
          SVG pictures
        </label>
        <label class="flex items-center gap-1.5 text-xs font-semibold" style="color: var(--ui-text-primary);">
          Send to
          <select class="rounded border px-2 py-1 text-xs" style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);" bind:value={directSlot} aria-label="Column to ask">
            <option value="">All contestants</option>
            {#each ["A", "B", "C", "D"].slice(0, $arenaPanelCount) as s}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </label>
      </div>
      <ChatInput onSend={onComposerSend} onStop={stopAll} />
    </section>
    {/if}
  </div>
  {/if}

  </div><!-- end main content column -->

  <!-- === Docked right settings panel. Collapsed = zero flex width + fixed edge tab. === -->
  {#if arenaSettingsCollapsed}
    <!-- Zero-width placeholder; button fixed at screen right so it never eats panel space -->
    <div class="shrink-0 hidden md:block" style="width: 0; overflow: visible;">
      <button
        type="button"
        class="panel-tab"
        style="position: fixed; right: 0; top: 50%; --panel-tab-transform: translate(0, -50%); transform: translate(0, -50%); border-radius: 8px 0 0 8px; border-right: none; z-index: 150;"
        title="Show Arena settings"
        aria-label="Show Arena settings"
        onclick={() => (arenaSettingsCollapsed = false)}
      >
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
      </button>
    </div>
  {:else}
    <button
      type="button"
      class="fixed inset-0 z-40 bg-black/40"
      aria-label="Close Arena settings"
      onclick={() => (arenaSettingsCollapsed = true)}
    ></button>
    <aside
      class="shrink-0 border-l hidden md:flex flex-col relative z-50 overflow-visible"
      style="width: 320px; background-color: var(--ui-bg-main); border-color: var(--ui-border);"
    >
      <div class="w-full flex flex-col min-h-0 h-full min-w-0 overflow-hidden">
      <div
        class="shrink-0 flex items-center justify-between px-4 py-3 border-b"
        style="border-color: var(--ui-border);"
      >
        <h2 class="text-sm font-semibold" style="color: var(--ui-text-primary);">Arena Settings</h2>
        <button
          type="button"
          class="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70 shrink-0"
          style="color: var(--ui-text-secondary);"
          title="Hide Arena settings"
          aria-label="Hide Arena settings"
          onclick={() => (arenaSettingsCollapsed = true)}
        >
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <!-- 1. Arena Builder (Phase 1: question generation) -->
        <section>
          <h3 class="font-semibold text-sm mb-1" style="color: var(--ui-text-primary);">Arena Builder</h3>
          <p class="text-xs mb-2" style="color: var(--ui-text-secondary);">
            Configure below, then click <strong>Build Arena</strong> on the bar. The judge model (selected below) will generate the question set.
          </p>
          <div class="flex items-center gap-2 mb-3">
            <span class="text-xs font-medium shrink-0" style="color: var(--ui-text-secondary);">Difficulty level</span>
            <select
              id="arena-builder-difficulty"
              class="h-8 min-w-[8rem] pl-2 pr-8 text-xs font-medium rounded-md border bg-transparent cursor-pointer"
              style="border-color: var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);"
              aria-label="Question difficulty 1 (easiest) to 5 (frontier)"
              bind:value={arenaBuilderDifficultyLevel}
            >
              <option value={1}>1 — Easiest</option>
              <option value={2}>2</option>
              <option value={3}>3 — Medium</option>
              <option value={4}>4</option>
              <option value={5}>5 — Frontier only</option>
            </select>
          </div>
          <p class="text-[11px] mb-3 -mt-1" style="color: var(--ui-text-secondary);">
            Instructs the model generating questions: 1 = broadly solvable; 5 = difficulty typically only solvable by frontier-level models.
          </p>
          <div class="flex items-center gap-2 mb-3">
            <span class="text-xs font-medium shrink-0" style="color: var(--ui-text-secondary);">Judge Internet Access</span>
            <div class="flex h-8 rounded-md border overflow-hidden" style="border-color: var(--ui-border); background: var(--ui-input-bg);">
              <button
                type="button"
                class="arena-web-tab h-full px-3 text-xs font-medium"
                class:active={!$arenaBuilderInternetEnabled}
                onclick={() => arenaBuilderInternetEnabled.set(false)}
                title="Judge uses internal knowledge only when generating questions"
              >OFF</button>
              <button
                type="button"
                class="arena-web-tab h-full px-3 text-xs font-medium border-l"
                class:active={$arenaBuilderInternetEnabled}
                style="border-color: var(--ui-border);"
                onclick={() => arenaBuilderInternetEnabled.set(true)}
                title="Judge may use web search when generating questions"
              >ON</button>
            </div>
          </div>
          <label for="arena-builder-categories" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Categories or topics (comma- or newline-separated)</label>
          <textarea
            id="arena-builder-categories"
            class="w-full rounded-md resize-y text-[13px] font-sans mb-3"
            style="padding: 10px; background-color: var(--ui-input-bg); border: 1px solid var(--ui-border); color: var(--ui-text-primary); min-height: 72px;"
            placeholder="e.g. physics, algorithms, history"
            rows="3"
            bind:value={arenaBuilderCategories}
          ></textarea>
          <label for="arena-builder-count" class="block text-xs font-medium mb-1" style="color: var(--ui-text-secondary);">Number of questions</label>
          <input
            id="arena-builder-count"
            type="number"
            min="1"
            max="100"
            class="w-full rounded-md text-[13px] font-sans px-3 py-2 border"
            style="background-color: var(--ui-input-bg); border-color: var(--ui-border); color: var(--ui-text-primary);"
            bind:value={arenaBuilderQuestionCount}
          />
          {#if buildArenaError}
            <p class="text-xs mt-2 font-medium" style="color: var(--atom-teal);" role="alert">{buildArenaError}</p>
          {/if}
        </section>
        <!-- 2. Judge instructions -->
        <section>
          <h3 class="font-semibold text-sm mb-1" style="color: var(--ui-text-primary);">Judge instructions</h3>
          <textarea
            class="w-full rounded-md resize-y text-[13px] font-sans"
            style="padding: 10px; background-color: var(--ui-input-bg); border: 1px solid var(--ui-border); color: var(--ui-text-primary); min-height: 60px;"
            placeholder="Custom rubric, e.g. Weight accuracy 60%, conciseness 20%, formatting 20%."
            rows="2"
            bind:value={judgeInstructions}
          ></textarea>
        </section>
        <!-- 3. Judge feedback -->
        <section>
          <h3 class="font-semibold text-sm mb-1" style="color: var(--ui-text-primary);">Judge feedback</h3>
          <textarea
            class="w-full rounded-md resize-y text-[13px] font-sans"
            style="padding: 10px; background-color: var(--ui-input-bg); border: 1px solid var(--ui-border); color: var(--ui-text-primary); min-height: 60px;"
            placeholder="Optional correction, e.g. The correct answer to Q3 is 42."
            rows="2"
            bind:value={judgeFeedback}
          ></textarea>
        </section>
        <!-- 4. Contest rules (accordion) -->
        <section>
          <div class="flex items-center gap-2 mb-2">
            <label for="arena-numeric-precision" class="text-xs font-medium shrink-0" style="color: var(--ui-text-secondary);">Numeric answer precision</label>
            <select
              id="arena-numeric-precision"
              class="h-8 min-w-[10rem] pl-2 pr-8 text-xs rounded-md border flex-1"
              style="border-color: var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);"
              aria-label="Digits for numeric answers (contestants and judge)"
              value={arenaNumericPrecision != null ? String(arenaNumericPrecision) : ""}
              onchange={(e) => {
                const v = e.currentTarget?.value;
                arenaNumericPrecision = v === "" ? null : Math.min(5, Math.max(0, parseInt(v, 10) || 0));
              }}
            >
              <option value="">Not specified</option>
              <option value="0">Integer (0 decimals)</option>
              <option value="1">1 decimal place</option>
              <option value="2">2 decimal places</option>
              <option value="3">3 decimal places</option>
              <option value="4">4 decimal places</option>
              <option value="5">5 decimal places</option>
            </select>
          </div>
          <p class="text-[11px] mb-2" style="color: var(--ui-text-secondary);">
            When set, contestants are told how many decimal places to use for numeric answers; the judge scores numeric answers to this precision.
          </p>
          <button
            type="button"
            class="w-full flex items-center justify-between text-left font-semibold text-sm mb-2"
            style="color: var(--ui-text-primary);"
            onclick={() => (settingsRulesExpanded = !settingsRulesExpanded)}
            aria-expanded={settingsRulesExpanded}
          >Contest rules <span aria-hidden="true">{settingsRulesExpanded ? "▼" : "▶"}</span></button>
          {#if settingsRulesExpanded}
            <textarea
              class="w-full px-3 py-2 rounded-lg border text-xs resize-y max-h-[200px]"
              style="border-color: var(--ui-border); background-color: var(--ui-input-bg); color: var(--ui-text-primary);"
              placeholder="Sent with every question."
              rows="3"
              bind:value={contestRules}
            ></textarea>
          {/if}
        </section>
        <!-- 5. Execution -->
        <section>
          <h3 class="font-semibold text-sm mb-2" style="color: var(--ui-text-primary);">Execution</h3>
          <label class="flex items-start gap-2 cursor-pointer text-xs" style="color: var(--ui-text-secondary);">
            <input type="checkbox" bind:checked={$arenaBlindReview} class="rounded mt-0.5" style="accent-color: var(--ui-accent);" />
            <span>Blind review (shuffled, anonymous)</span>
          </label>
          <label class="flex items-start gap-2 cursor-pointer text-xs mt-1.5" style="color: var(--ui-text-secondary);">
            <input type="checkbox" bind:checked={$arenaDeterministicJudge} class="rounded mt-0.5" style="accent-color: var(--ui-accent);" />
            <span>Deterministic judge (temp 0)</span>
          </label>
          <div class="flex items-center gap-2 mt-2.5">
            <label for="arena-timeout" class="text-xs shrink-0" style="color: var(--ui-text-secondary);">Timeout</label>
            <input
              id="arena-timeout"
              type="number"
              min="60"
              max="900"
              step="30"
              class="w-20 px-2 py-1 rounded border text-right text-xs font-mono"
              style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-primary);"
              value={$arenaRequestTimeoutSeconds}
              oninput={(e) => { const v = parseInt(e.currentTarget?.value, 10); if (v >= 60 && v <= 900) arenaRequestTimeoutSeconds.set(v); }}
            />
            <span class="text-xs" style="color: var(--ui-text-secondary);">seconds</span>
          </div>
        </section>
        <!-- 6. Judge model -->
        <section>
          <h3 class="font-semibold text-sm mb-2" style="color: var(--ui-text-primary);">Judge model</h3>
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
            {#each groupModelsForSelector(prepareArenaModelList($models, $modelPricingCatalog).filter((m) => {
              const cIds = [$dashboardModelA, $dashboardModelB, $dashboardModelC, $dashboardModelD].map((s) => (s || "").trim().toLowerCase()).filter(Boolean);
              return !cIds.includes((m.id || "").trim().toLowerCase());
            })) as g}
              <optgroup label={g.title}>
                {#each g.items as m (m.id)}
                  <option value={m.id}>{modelSelectorPrimaryLine(m.id)}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </section>
        <!-- 7. Score breakdown -->
        <section>
          <h3 class="font-semibold text-sm mb-2" style="color: var(--ui-text-primary);">Score breakdown</h3>
          <ArenaScoreMatrix
            {scoreHistory}
            totals={arenaScores}
            visibleSlots={$arenaPanelCount >= 4 ? ["A","B","C","D"] : $arenaPanelCount >= 3 ? ["A","B","C"] : $arenaPanelCount >= 2 ? ["A","B"] : ["A"]}
          />
        </section>
        <!-- 8. Actions -->
        <section>
          <h3 class="font-semibold text-sm mb-2" style="color: var(--ui-text-primary);">Actions</h3>
          <div class="flex flex-col gap-2">
            <button
              type="button"
              class="w-full px-3 py-2 rounded-lg text-sm font-medium border"
              style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-secondary);"
              onclick={confirmResetScores}
            >Reset all scores</button>
            <button
              type="button"
              class="w-full px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
              style="border-color: var(--ui-border); background: var(--ui-input-bg); color: var(--ui-text-secondary);"
              disabled={ejectBusy}
              onclick={confirmEjectAll}
            >{ejectBusy ? "Ejecting…" : "Eject all models"}</button>
            {#if ejectMessage}
              <span class="text-xs" style="color: var(--atom-teal);" role="status">{ejectMessage}</span>
            {/if}
          </div>
        </section>
      </div>
    </div>
    </aside>
  {/if}
  </div><!-- end flex row -->

  <!-- Judgment sheet: slides up from the bottom so slot D stays visible. -->
  {#if judgmentPopup}
    <div
      class="fixed inset-x-0 bottom-0 z-[200] flex flex-col pointer-events-none"
      role="complementary"
      aria-label="Judgment results"
    >
      <div
        class="flex flex-col pointer-events-auto shadow-2xl"
        style="background-color: var(--ui-bg-sidebar); border-top: 3px solid var(--ui-accent);"
        transition:fly={{ y: 420, duration: 350, easing: quintOut }}
        role="region"
        aria-label="Judge round results"
        onmouseenter={() => (judgmentDrawerHovered = true)}
        onmouseleave={() => (judgmentDrawerHovered = false)}
        onfocusin={() => (judgmentDrawerHovered = true)}
        onfocusout={() => (judgmentDrawerHovered = false)}
      >
        <!-- Auto-close progress bar -->
        <div class="shrink-0 h-0.5 w-full" style="background: color-mix(in srgb, var(--ui-border) 40%, transparent);">
          <div class="h-full transition-none" style="width: {judgmentAutoCloseProgress * 100}%; background: var(--ui-accent); opacity: {judgmentDrawerHovered ? 0.3 : 0.7};"></div>
        </div>
        <!-- Drawer header -->
        <div class="shrink-0 flex items-center justify-between px-3 py-2.5" style="border-bottom: 1px solid var(--ui-border);">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded" style="background: color-mix(in srgb, var(--ui-accent) 12%, transparent); color: var(--ui-accent);">Judge</span>
            <span class="text-sm font-semibold" style="color: var(--ui-text-primary);">Round Results</span>
            {#if standingShort}
              <span class="text-sm font-semibold tabular-nums" style="color: var(--ui-text-primary);" title={reportHeadline}>{standingShort}</span>
            {:else if reportHeadline}
              <span class="text-sm" style="color: var(--ui-text-primary);" title={reportHeadline}>{reportHeadline}</span>
            {/if}
          </div>
          <div class="flex items-center gap-1.5">
            <!-- Copy JSON -->
            <button
              type="button"
              class="px-2 py-1 rounded text-[10px] font-medium transition-opacity hover:opacity-80"
              style="color: var(--ui-text-secondary); border: 1px solid var(--ui-border);"
              onclick={() => {
                const raw = judgmentPopup.rawJudgeOutput ?? judgmentPopup.explanation;
                const explanations = judgmentPopup.explanations && Object.keys(judgmentPopup.explanations).length > 0
                  ? judgmentPopup.explanations
                  : parseJudgeScoresAndExplanations(judgmentPopup.explanation).explanations;
                navigator.clipboard?.writeText(JSON.stringify({ questionIndex: judgmentPopup.questionIndex ?? -1, scores: judgmentPopup.scores, explanations: Object.keys(explanations || {}).length ? explanations : undefined, rawExplanation: raw }, null, 2));
              }}
              aria-label="Copy results as JSON">JSON</button>
            <!-- Copy CSV -->
            <button
              type="button"
              class="px-2 py-1 rounded text-[10px] font-medium transition-opacity hover:opacity-80"
              style="color: var(--ui-text-secondary); border: 1px solid var(--ui-border);"
              onclick={() => {
                const q = judgmentPopup.questionIndex ?? -1;
                const expl = judgmentPopup.explanations || {};
                const rows = ["A", "B", "C", "D"].filter((s) => judgmentPopup.scores[s] !== undefined).map((s) => `${q},${s},${judgmentPopup.scores[s]},"${(expl[s] ?? "").replace(/"/g, '""')}"`);
                navigator.clipboard?.writeText(["questionIndex,slot,score,explanation", ...rows].join("\n"));
              }}
              aria-label="Copy results as CSV">CSV</button>
            <!-- Close -->
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-lg text-lg leading-none transition-opacity hover:opacity-70"
              style="color: var(--ui-text-secondary);"
              onclick={() => { judgmentPopup = null; }}
              aria-label="Close">×</button>
          </div>
        </div>

        <div class="shrink-0 grid px-3 py-1.5" style="grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px;">
          {#each ["A", "B", "C", "D"] as s (s)}
            {@const hasScore = judgmentPopup.scores[s] !== undefined}
            {@const sc = hasScore ? judgmentPopup.scores[s] : null}
            {@const expl = judgmentPopup.explanations?.[s] || ""}
            <div class="arena-judge-cell arena-col-{s} rounded-lg px-2 py-1 min-w-0" style="opacity: {hasScore ? 1 : 0.45};" title={expl || s}>
              <div class="flex items-baseline gap-1.5 min-w-0">
                <span class="arena-ink text-sm font-extrabold shrink-0">{s}</span>
                <span class="arena-tally-num arena-ink text-sm tabular-nums shrink-0">{hasScore ? sc : '—'}/10</span>
              </div>
              {#if expl}
                <p class="m-0 text-sm font-semibold leading-snug arena-ink truncate">{expl}</p>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Old modal settings panel removed: now docked as right sidebar above -->
</div>

<style>
  .arena-chrome {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 5px 12px;
    overflow-x: auto;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-bg-sidebar, var(--ui-input-bg));
  }
  .arena-chrome-rule {
    width: 1px;
    height: 18px;
    flex: 0 0 auto;
    background: var(--ui-border);
  }
  .arena-chrome :global(.arena-command-toolbar) {
    border: 0;
    background: transparent;
    flex: 0 0 auto;
    width: auto;
    min-width: 0;
    overflow: visible;
  }
  .arena-session-end {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }
  .arena-chrome :global(.arena-lineup) {
    border: 0;
    background: transparent;
    max-height: none;
    min-height: 0;
    padding: 0;
    flex: 0 1 auto;
    min-width: 0;
  }
  .arena-report-inline {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .arena-standing {
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 3px 9px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ui-accent) 14%, var(--ui-bg-main));
    color: var(--ui-text-primary);
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
  }
  .arena-seg {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: var(--ui-input-bg);
  }
  .arena-seg button {
    height: 24px;
    padding: 0 8px;
    border: 0;
    background: transparent;
    color: var(--ui-text-secondary);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
  .arena-seg button + button {
    border-left: 1px solid var(--ui-border);
  }
  .arena-seg button[aria-pressed="true"] {
    background: var(--ui-action, var(--ui-accent));
    color: var(--ui-action-ink, var(--ui-bg-main));
  }
  .arena-report-btn {
    height: 24px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--ui-border);
    background: var(--ui-input-bg);
    color: var(--ui-text-primary);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
  .arena-report-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .arena-question-bar {
    width: 100%;
    padding: 12px 16px 14px;
    background: var(--ui-bg-main);
    border-bottom: 1px solid var(--ui-border);
  }
  .arena-question-read {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0;
    width: 100%;
    color: var(--arena-read, var(--ui-text-primary));
  }
  .arena-question-num {
    flex: 0 0 auto;
    margin-top: 4px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
    color: var(--ui-accent);
  }
  .arena-question-text {
    min-width: 0;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .arena-question-clamp {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>

