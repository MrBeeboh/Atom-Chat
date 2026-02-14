# Arena Controlled Hardening — Deliverables

## 1. Restore point

- **Tag:** `arena-pre-hardening`
- **Commit:** Created immediately before hardening changes (key files: ArenaPanel.svelte, DashboardArena.svelte, ArenaControlBar.svelte, stores.js, arenaLogic.js).
- **Restore:** `git checkout arena-pre-hardening`

---

## 2. Summary of files modified

| File | Purpose |
|------|--------|
| **src/lib/arenaLogic.js** | Added `normalizeGeneratedQuestionSet(parsed)` to produce question objects `{ id, text, category?, correct_answer?, grading_rubric? }` with stable ids (`q-0`, `q-1`, …). No change to `parseGeneratedQuestionSet` or scoring. |
| **src/lib/stores.js** | Added `arenaDebugMode` (writable, default `false`). When true, Arena logs prompt, raw_response, latency, shuffle_order, judge_raw_output to console. No UI. |
| **src/lib/components/ArenaPanel.svelte** | Added prop `currentQuestionId`. Filter logic: if `currentQuestionId != null`, hide user messages with that `questionId`; else if `currentQuestionText` set, fall back to string match; else show all. Existing rendering unchanged. |
| **src/lib/components/ArenaControlBar.svelte** | Question dropdown supports both string and object items: preview uses `q.text` when `q` is an object. |
| **src/lib/components/DashboardArena.svelte** | (1) Build: use `normalizeGeneratedQuestionSet`, store `builtQuestionSet = { questions }`, set `arenaRunMetadata` (run_id, timestamp, judge_model, contestant_models, blind_review, deterministic_judge, builder_internet_enabled, question_count, categories, **seed**). (2) Run: use `arenaRunMetadata?.seed` for `arenaCurrentRunMeta.seed` (deterministic shuffle). (3) Questions: `parsedQuestions` = array of question objects; `currentQuestionText` / `currentQuestionId` / `currentQuestionAnswer` derived from current item. (4) Send: `sendUserMessage(text, imageDataUrls, questionId)`; `sendToSlot(..., questionId)`; user message includes `questionId` when provided. (5) Timeout: 120s soft timeout, retry once on AbortError; on second failure set empty content and slot error so judge assigns 0. (6) Debug: when `arenaDebugMode` true, log slot response (prompt, raw_response, latency), shuffle_order, judge_raw_output. |

---

## 3. Diff summary

```
 src/lib/arenaLogic.js                     |  29 ++++
 src/lib/components/ArenaControlBar.svelte |   4 +-
 src/lib/components/ArenaPanel.svelte      |  16 +-
 src/lib/components/DashboardArena.svelte  | 236 ++++++++++++++++++------------
 src/lib/stores.js                         |   3 +
 5 files changed, 192 insertions(+), 96 deletions(-)
```

---

## 4. New state variables

| Variable | Location | Type | What it controls |
|----------|----------|------|-------------------|
| **arenaRunMetadata** | DashboardArena.svelte | `$state(null \| RunMetadata)` | In-memory run metadata set on Build Arena: run_id, timestamp, judge_model, contestant_models, blind_review, deterministic_judge, builder_internet_enabled, question_count, categories, **seed**. Used for reproducibility and to supply seed for shuffle on first Send. |
| **arenaDebugMode** | stores.js | `writable(false)` | When true, Arena logs prompt, raw_response, latency, shuffle_order, judge_raw_output to console. No UI change. |
| **currentQuestionId** | DashboardArena.svelte | `$derived(string \| null)` | Id of the current question (e.g. `q-0`). Passed to ArenaPanel and sendUserMessage so filtering and messages use id instead of string match. |
| **currentQuestionItem** | DashboardArena.svelte | `$derived(object \| null)` | Current question object from `parsedQuestions[questionIndex % length]`. Used to derive currentQuestionText, currentQuestionId, currentQuestionAnswer. |
| **displayMessages** (logic change) | ArenaPanel.svelte | `$derived` | When `currentQuestionId != null`, filters out user messages with that `questionId`; else falls back to `currentQuestionText` string match. |
| **questionId** on user messages | DashboardArena (pushMessage) | property on message object | Optional `questionId` on user messages so panels filter by id instead of string. |

**Existing state unchanged in behavior (only usage/source):**

- **builtQuestionSet.questions** — Now an array of `{ id, text, correct_answer?, category?, grading_rubric? }` instead of `string[]`. `parsedAnswers` derived from `questions[].correct_answer`.
- **arenaCurrentRunMeta.seed** — Now taken from `arenaRunMetadata?.seed` when set (on first run after Build), so shuffle is deterministic for that run.

---

## Constraints respected

- **No UI redesign** — No layout, buttons, or phase structure changed.
- **No execution flow changes** — Ask / Next / Run All / Build / Judge flow unchanged; only data shape and timeout/retry added.
- **No model loading logic changes** — Load/unload order and rules unchanged.
- **Preserve existing behavior** — Panel filtering falls back to string match when `currentQuestionId` is null; ControlBar supports both string and object for dropdown; scoring scale and blind review logic unchanged.
