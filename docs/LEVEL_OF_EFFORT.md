# ATOM UI (LM Studio UI) — Level of Effort (LOE)

Date: 2026-02-11

This document summarizes the approximate size and effort implied by the current repository contents for the ATOM UI app (LM Studio UI frontend). It is intended for review/forwarding.

## How these numbers were produced

Counts were computed from the git-tracked working tree in `C:\CURSOR\lm-studio-ui`.

To avoid misleading inflation, the following were excluded from “application code” counts:
- `node_modules/`
- `dist/`
- Python virtualenv content under `services/.venv/` (tracked in this repo, but not part of the UI app implementation)

## Repository size (tracked)

- Tracked files (all types): **980**

## Core UI application code (frontend)

Primary app code lives in `src/`.

- `src/` text source files (`.svelte`, `.js`, `.css`): **52 files**
- Total LOC in `src/`: **11,901 lines**

Breakdown highlights:
- Svelte components under `src/lib/components/`: **28 files**, **6,540 LOC**
- Tests under `src/` (`*.spec.*`): **2 files**, **580 LOC**

## Documentation & artifacts

Markdown documentation (repo-wide, excluding vendor/build dirs):
- Markdown docs (`.md`): **30 files**, **1,450 lines**

Top-level JSON artifacts (handoffs/config exports, etc.):
- Top-level `.json`: **7 files**, **5,733 lines**

Notes:
- The JSON line count is dominated by large handoff/export style files (e.g., agent handoff extracts). These are documentation/artifacts rather than runtime code.

## Supporting scripts / tooling (repo)

Excluding virtualenv content:
- Batch scripts (`.bat`): **6 files**, **184 lines**
- PowerShell (`.ps1`): **1 file**, **28 lines**
- Node scripts (`.mjs`): **2 files**, **96 lines**
- Python scripts (`.py`, excluding venv): **3 files**, **273 lines**

## Features that drive LOE (what the codebase includes)

The current app implementation includes multiple non-trivial feature areas that typically dominate engineering time beyond raw LOC:

- Svelte 5 (runes) SPA architecture + multi-layout UI (Cockpit/Arena/etc.)
- Multi-model “Arena” workflow (parallel/sequential runs, scoring, judge prompts, score history)
- Streaming chat completions against LM Studio’s OpenAI-compatible API
- Local persistence (IndexedDB via Dexie)
- Markdown rendering + code highlighting for message bubbles
- Web search integration and warm-up/connection state
- Optional voice-to-text (separate `voice-server/` service)
- Metrics panels (optional hardware bridge server)
- Theming/layout primitives and UI state management

## LOE estimate (engineering time)

Because we do not have a clean “before vs after” baseline in this document, the estimates below are **heuristics** based on:
- the current app size (~12k LOC in `src/`)
- the number of distinct feature domains
- the operational polish (themes, settings, persistence, streaming, Arena orchestration)

### Reasonable implementation ranges

For a single experienced engineer (full-time), with intermittent iteration/debugging and some UI polish:
- **MVP core chat UI** (streaming, basic settings, message rendering): ~**1–3 weeks**
- **Arena feature set** (multi-slot orchestration + judge/scoring + persistence): ~**2–5 weeks**
- **Polish & hardening** (themes, error handling, scripts/tooling, UX refinement): ~**1–3 weeks**

Overall range for the current scope:
- **~4–11 engineer-weeks** (1 engineer), depending on how much was “greenfield” vs adapted from existing patterns.

### What can move the estimate up or down

- Upward drivers: difficult edge cases (streaming, race conditions), multi-model orchestration complexity, iterative UX tuning, integrating multiple optional services.
- Downward drivers: reuse of prior code/templates, pre-existing design system, stable API surface, minimal cross-browser requirements.

## Caveats / review notes

- LOC is not effort, but it is a useful proxy when combined with feature complexity.
- This repo currently tracks `services/.venv/`, which can massively distort naive line counts if not excluded.
- If you want a more defensible LOE for a specific time window, we can produce a git-based delta (e.g., from an earlier tag/commit) using `git diff --stat` and commit history.
