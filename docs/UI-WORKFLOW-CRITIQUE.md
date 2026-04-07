# UI / workflow critique — concrete improvements

Based review of the codebase. No fluff.

---

## 1. "Witty" status copy — reduce or remove

**Where:** `cockpitCopy.js` + `pickWitty()` used in header/chat.

**Issue:** Rotating messages ("Pinging the local brain…", "One sec, checking the garage…") feel gimmicky and add visual noise. Users need one clear state, not a new phrase every time.

**Change:**
- Use **one short label per state**: e.g. "Connecting…", "Connected", "Disconnected", "Cloud only".
- Remove `pickWitty()` and the arrays of alternatives; use a single string (or at most two) per state.
- Optional: keep one "playful" variant in a single place (e.g. tooltip only), not in the main status text.

---

## 2. Settings panel — too much at once

**Where:** `SettingsPanel.svelte`.

**Issue:** One long scroll: LM Studio URL, Unload helper, Voice server, Cloud APIs (5 keys), Audio, Preset default models. Power users need it; casual users get overwhelmed.

**Change:**
- **Split:** "Connection" (LM Studio, Unload, Voice URL) vs "API keys" (DeepSeek, Grok, Brave, DeepInfra, Together) vs "Audio" vs "Presets". Use collapsible sections or tabs so only one group is visible at a time.
- **Shorten helper text:** e.g. "Leave empty for default" instead of a full sentence with code blocks where possible. Move long instructions to a "Help" link or README.
- **Brave key:** Already one of many; consider grouping under "API keys" with a single intro line: "Keys are stored in your browser only."

---

## 3. Header density (Cockpit)

**Where:** `App.svelte` cockpit header.

**Issue:** Brand + layout tabs + Model + Preset + Theme + Toggle + Status in one bar. On small screens or with long model IDs it gets cramped.

**Change:**
- Drop "Model" / "Theme" labels if the controls are obvious (dropdown = model, theme selector = theme).
- Consider moving Preset into the model dropdown or into Intel panel to free space.
- Status: dot + one short word ("Connected" / "Offline") is enough; no need for a long sentence.

---

## 4. Red "Save" button in Settings

**Where:** Settings panel footer.

**Issue:** Save is the primary action but not destructive; red reads as danger (e.g. "Delete all").

**Change:** Use the same style as your accent (e.g. primary green/blue) for Save. Keep red for "Reset to defaults" or real destructive actions only.

---

## 5. Duplicate / redundant comments in code

**Where:** Several files.

**Examples:**
- `duckduckgo.js`: Top blurb says "No API key. Uses CORS proxy" but you use Brave backend proxy; the CORS proxy list in comments is obsolete (corsproxy.io 403 DEAD etc.).
- `stores.js`: File-level comment is useful; per-store comments like "When set, ChatInput processes…" are optional if the name is clear.
- Component headers: e.g. IntelPanel's 4-line block is good once; not every component needs a paragraph.

**Change:**
- Remove or rewrite outdated comments (e.g. duckduckgo: "Web search via local Brave proxy. Key in Settings or env.").
- Prefer one concise file-level comment over many one-liners unless the logic is non-obvious.

---

## 6. Arena vs Cockpit — two UIs, one app

**Where:** Layout toggle + different headers/panels for Arena vs Cockpit.

**Issue:** Two full layouts increase code paths and testing; some users may not need Arena at all.

**Change (optional):**
- If most use is Cockpit: consider Arena as a "mode" or secondary route (e.g. /arena) instead of a header toggle, to simplify the default view.
- If both are core: keep but ensure shared components (Model selector, Theme, Status) are identical in behavior and copy so the app doesn’t feel like two different products.

---

## 7. Intel panel — information density

**Where:** `IntelPanel.svelte`.

**Issue:** System prompt, params, context bar, load options, Optimize, Save, model card, etc. in one column. Functional but dense.

**Change:**
- Group with clear headings and optional collapse: "Prompt", "Generation", "Load options", "Actions".
- "Optimize" / "Save" could be one row of buttons with short labels; avoid long explanatory text in the main panel.
- Move rarely changed options (e.g. CPU threads, n_parallel) into an "Advanced" subsection.

---

## 8. Sidebar "Arena mode" banner

**Where:** `Sidebar.svelte` when layout is Arena.

**Issue:** The line "Arena mode — competition messages live in the Arena panels (not saved here)…" is long for a sidebar.

**Change:** Shorten to e.g. "Arena: messages in panels only." or a tooltip on an icon; free the space for the conversation list.

---

## 9. Error / toast messages

**Where:** Chat and other views (e.g. "Web search failed after retry…").

**Issue:** Long, instructional copy in the main content area draws too much attention.

**Change:** Short primary message ("Web search unavailable") with a "Details" or "Fix" that expands or links to Settings. Keep the rest in a secondary line or tooltip.

---

## 10. Consistency and polish

- **Terminology:** Use one term for the same thing (e.g. "LM Studio" vs "local server"; "preset" vs "system prompt" if they’re the same).
- **Buttons:** Same padding/size for same hierarchy (e.g. all "secondary" actions same style).
- **Spacing:** Reuse a small set of spacing values (e.g. 4, 8, 12, 16px) instead of one-off values.

---

## Priority order (if doing incrementally)

1. **High:** Remove or simplify witty status copy; one clear label per state.
2. **High:** Settings: collapsible sections or tabs + shorter helper text.
3. **Medium:** Settings Save button color (accent, not red).
4. **Medium:** Duckduckgo (and similar) comment cleanup; remove obsolete CORS proxy notes.
5. **Lower:** Header label trim; Sidebar Arena banner shorten; error message length.

This doc is a checklist for implementation, not a design spec. Adjust to your own priorities (e.g. if Arena is rarely used, simplifying it has higher payoff).
