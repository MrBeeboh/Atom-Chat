# Agent handoffs (canonical reference)

Two handoff JSONs live in this folder so a **new agent** can copy code from this project into another without importing from this repo.

| File | Use when |
|------|----------|
| **`AGENT-HANDOFF-FULL-EXTRACT.json`** | Copy the **entire app** (API, db, chat view, settings, model selector, themes, layouts, stores, etc.) into a new project. Single file; resolve paths with `source_project_root`; use `all_source_paths_to_copy_or_extract` and `index_by_source_path`. |
| **`AGENT-HANDOFF-THEMES-AND-LAYOUTS.json`** | Copy **only themes and layouts** (themeOptions, theme CSS, UiThemeSelect, ThemePickerModal, ThemeToggle, layout stores, App layout branches, DashboardArena, ModelSelectorSlot). |
| **`AGENT-NEW-AGENT-DEPTH-ANSWERS.json`** | **Depth answers** (traced from code): DashboardArena (A/B/C/D run, sendToSlot, column rendering, ChatInput usage), IntelPanel (data, stores), FloatingMetricsDashboard/PerfStats (tok data source, persistence), file handling and web search flow. Use when copying or rewiring those areas. |

**Rules for both:** Copy file contents; no imports from this repo. **Do not copy** `ChatInput.svelte` or any voice/microphone/Send-button logic; build your own chat input and plug it into the same send/stream flow. In **AGENT-HANDOFF-FULL-EXTRACT.json**, see the **`chat_input_correct_behavior`** key for the single reference spec (text input, Send behavior, after-first-message, voice-to-text if implemented, summary).

---

## Themes and layouts (short reference)

This app’s **themes** and **layouts** are also described in **`AGENT-HANDOFF-THEMES-AND-LAYOUTS.json`**. Use it when you only need theme/layout spec.

## Themes

- **Source of truth:** `src/lib/themeOptions.js` (`UI_THEME_OPTIONS`)
- **CSS:** `src/app.css` — block `/* UI theme variables */` with `[data-ui-theme="..."]` and `.dark[data-ui-theme="..."]`
- **Stores:** `uiTheme`, `theme` in `src/lib/stores.js`
- **Components:** `UiThemeSelect.svelte`, `ThemePickerModal.svelte`, `ThemeToggle.svelte`
- **Apply:** `document.documentElement.dataset.uiTheme = value`

Theme values include: atom, default, cyberpunk, neural, quantum, arctic, neon, mint, coral, highcontrast, cybercitrus, industrialhazard, fireice, hacker, medical, radioactivelab, coppercircuit, arcticneon, sunsetgradient, racingstripe, jungleterminal, magmaflow, chromeglass, toxicwaste, oceandeep.

## Layouts

- **Values:** `cockpit` | `arena`
- **Stores:** `layout`, `dashboardModelA`–`D`, `effectiveModelId`, `cockpitIntelOpen`, `arenaPanelCount` in `src/lib/stores.js`
- **App:** `src/App.svelte` — layout switcher in header; `{#if layout === 'cockpit'} ... {:else if layout === 'arena'} ...`
- **Arena components:** `DashboardArena.svelte`, `ModelSelectorSlot.svelte`

## Do not copy (from previous/other builds)

- `src/lib/components/ChatInput.svelte` (or any voice/mic/speech/Send logic from the old project)
- Microphone, voice, speech recognition, or Send-button logic
- `public/mic-reliability-test.js`, `scripts/run-mic-test.mjs`

Build chat/input in this project instead; do not reuse the old broken voice/input code.
