# Restore Point: Cockpit + Arena Only

This document describes the **restore point** where the app has exactly two layouts and Arena supports up to four models.

## Layouts

- **Cockpit** – Single-model chat with sidebar and header model selector.
- **Arena** – Multi-model comparison with 1–4 panels (slots A, B, C, D).

All other layouts have been **removed**: Flow, Focus, and Workbench. The default layout is **Cockpit**. Existing saved layout values (flow, focus, workbench, default, dashboard) are migrated to cockpit or arena as appropriate.

## Arena

- **Panel count:** 1, 2, 3, or 4 (user choice).
- **Slots:** A, B, C, D. When 4 panels are shown, Model D is available; its selection is persisted like A/B/C.
- Send goes to all active slots; stop stops all. TPS and errors are shown per panel.

## Themes / Colors

All theme and color templates are **unchanged**. Only layout templates were reduced to Cockpit and Arena.

## Tagging this state

After verifying everything works, tag this restore point:

```bash
git tag restore-cockpit-arena-clean
```

This is your **clean starting point** before adding new features. If things get messy later, you can always come back here with:

```bash
git checkout restore-cockpit-arena-clean
```

Then future work can start from this known-good state.
