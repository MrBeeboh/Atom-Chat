# DeepSeek context-cache audit (atom-chat)

Disk KV cache is on by default. Hits require an **exact prefix match from token 0**. Fields: `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens` ([docs](https://api-docs.deepseek.com/guides/kv_cache)). Streaming usage is on the **last** chunk (`usage` non-null). The SSE example omits cache fields; the KV guide is the source of truth. Aliases we accept: `cached_tokens` (OpenAI), `cache_read_input_tokens` / `cache_creation_input_tokens` (Anthropic-style).

## Call sites (all go through `api.js`)

| Site | File:line | Path |
|---|---|---|
| Chat | `ChatView.svelte` ~380 | `streamChatCompletion` → `https://api.deepseek.com/v1/chat/completions` (not the Vite `/api/deepseek` proxy) |
| Arena contestant | `DashboardArena.svelte` ~930 | same |
| Arena judge | `DashboardArena.svelte` ~1617, ~1839 | same |
| Arena Build | `DashboardArena.svelte` ~315, ~324 | `requestChatCompletion` |
| HF optimize | `hfOptimize.js` ~400 | `requestChatCompletion` (one-shot; no reuse expected) |
| Metrics wrapper | `streamReporter.js` ~58 | unused in live App |
| atom-next | `experiments/atom-next/**` | not wired |

Vite `/api/deepseek` is **models list only** (`cloudCatalog.js` `listUrlDev`). Image gen is DeepInfra/Together, not DeepSeek chat.

Logging: `recordDeepSeekCacheUsage` on the final usage object (`streamChatCompletion` / `requestChatCompletion`). Console: `[DeepSeek cache] …`. In-memory: `getDeepSeekCacheLog()`.

## Violations

| Issue | File:line | Avoidable? |
|---|---|---|
| Follow-up turns stripped `<think>` from prior assistant text | `ChatView.svelte` (was ~233; now `deepSeekCache.js` `buildChatApiMessages`) | **Yes — fixed.** Prefix no longer matched the previous request+reply. |
| Documents tools + system hint only when `host.ok` | `ChatView.svelte` ~312 | **Yes — pinned** after first successful host probe (same tool schema + root). |
| Web search injected into the **latest user** turn | `ChatView.svelte` ~277 | No. Tail volatility; system prefix stays. |
| Prior-turn images replaced with `[Image attached]` | `deepSeekCache.js` `sanitizeContentForApi` | Expected size tradeoff. Miss on vision follow-ups. |
| Arena judge user blob (answers, web, prompt) | `arenaLogic.js` `buildJudgePrompt` ~831–860 | Expected. System is stable for a given slot set. |
| Arena question text changes per round | `DashboardArena.svelte` sendToSlot | Expected. `ARENA_CONTESTANT_SYSTEM_PROMPT` is a stable head. |
| Sliding-window / dropped early turns | none today (`getMessages` returns full history) | N/A; tests still label this as expected miss. |

Not found: timestamps or random IDs in the system head; non-deterministic `JSON.stringify` key order on the wire payload (`role` then `content`); “today’s date” in the cached head (`temporalController.js` is CSS only).

## Before / after (same fixture)

Conversation: system + “capital of China?” + assistant with `<think>` + “And of France?”

Prefix hit = follow-up messages (minus latest user) byte-equal to turn-1 messages + stored assistant.

| | Follow-up prefix hit |
|---|---|
| Before (strip `<think>`) | **0 / 1** |
| After (keep thinking on DeepSeek) | **1 / 1** |

Turn 1 is always a cold miss (not in the table). Live `hit/(hit+miss)` still depends on DeepSeek’s 64-token persist units; run a two-turn chat and watch `[DeepSeek cache]` in the console.

Tests: `src/lib/deepSeekCache.spec.js`.
