# Upgrades ported from `C:\Users\<you>\.lmstudio`

Another AI had been working on the same app from the **.lmstudio** folder. That copy was broken (missing component, etc.), so we ported the **good upgrades** into this repo and left out what was broken.

## What was ported

### 1. **Utils** (`src/lib/utils.js`)
- **makeDraggable** — Svelte action to make a panel draggable by a handle; position is persisted to localStorage and clamped to viewport.
- **makeResizable** — Svelte action to make an element resizable (bottom-right handle); size persisted to localStorage.

### 2. **Arena components** (from the “Arena refactor” in .lmstudio)
- **ArenaHeader.svelte** — Extracted header: model cards A–D (selector + score). Used in `DashboardArena.svelte`.
- **ArenaControlBar.svelte** — Extracted control bar: Question nav, Ask/Next/Run All, Web toggle, Judgment, Start Over, Settings. Used in `DashboardArena.svelte`.
- **ArenaQuestionPanel.svelte** — Draggable/resizable floating panel for the current question text. **Not yet wired into DashboardArena**; available for future use (e.g. show current question in a floating panel).

### 3. **DashboardArena.svelte**
- Replaced the **inline header** with `<ArenaHeader ... />`.
- Replaced the **inline control bar** with `<ArenaControlBar ... onOpenSettings={() => arenaSettingsOpen = true} />`.
- Behavior (questions, Ask, Next, Web, Judge, Settings, Start Over) is unchanged; the UI is now split into smaller components.

## What was not ported (and why)

- **ArenaAskJudgePanel** — Referenced in the .lmstudio `DashboardArena` but the file did **not** exist there. That missing import is what broke the app. We did not re-create it; the “Ask the Judge” UI remains inline in `DashboardArena` where it was in the repo.
- **ArenaSettingsPanel** — The file in .lmstudio was empty; the settings slide-out remains inline in `DashboardArena`.

## Source reference

- **Other AI’s folder:** `C:\Users\Fires\.lmstudio` (same project copy, different path).
- **Refactor notes:** `ARENA_REFACTORING_TURNOVER.json` in that folder describes the Arena component split (ArenaHeader, ArenaControlBar, ArenaAskJudgePanel, etc.).

You can keep using the .lmstudio folder as a read-only reference; this repo is the single source of truth and now includes these upgrades in a working state.
