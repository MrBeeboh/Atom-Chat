# Project structure and preferred location

## Preferred project folder

- **Folder name:** The app is **ATOM UI**. Name the local folder **`AtomUI`** (no space; scripts and terminals work without extra quoting). The GitHub repo can stay `lm-studio-ui`; the local folder name is up to you.
- **Location:** One folder = one project. Put it wherever you like; both are valid:
  - `C:\CURSOR\AtomUI` — keeps Cursor projects in one place
  - `C:\Users\<you>\Documents\AtomUI` or `C:\Users\<you>\source\repos\AtomUI` — under your user profile
- **Rule:** The **repo root** is the app root. All commands (`npm run dev`, `.\scripts\sync-master.ps1`, etc.) are run from this folder. Don’t nest the repo inside another “project” folder with a different structure.

## Folder layout (repo root = app root)

```
AtomUI/                 ← repo root = project root (run npm and scripts here)
├── docs/               ← Project docs (workflow, structure, handoff, etc.)
├── public/             ← Static assets (Vite)
├── scripts/            ← PowerShell helpers (sync, start-work, save-work, finish-work)
├── services/           ← Optional services (e.g. voice)
├── src/
│   ├── App.svelte      ← Root component
│   ├── app.css
│   ├── main.js
│   └── lib/            ← App code
│       ├── api.js      ← LM Studio / API
│       ├── db.js       ← IndexedDB (Dexie)
│       ├── stores.js   ← Svelte stores
│       ├── components/ ← Svelte UI components
│       └── utils/      ← Shared utilities
├── START-EVERYTHING.bat   ← Single launcher (LM Studio + Vite + browser)
├── kill_atom_ui.bat      ← Stop dev servers
├── package.json
├── vite.config.js
└── ...
```

## What not to add

- **No backup files in the repo.** Use `*.backup`, `*.backup-*`, etc. (they’re in `.gitignore`). Keep backups locally if you need them.
- **No stray files at repo root** (e.g. random `cd`, `git`, `npm` files). Only real project files and scripts.

## Clean clone (optional)

If you want a completely fresh folder from GitHub:

1. Commit and push your current work from this folder (so the repo is up to date).
2. Clone into a new folder:
   ```powershell
   git clone https://github.com/MrBeeboh/lm-studio-ui.git C:\CURSOR\AtomUI
   ```
3. Open the new folder (e.g. `C:\CURSOR\AtomUI`) in Cursor and run `npm install`.
4. Use `START-EVERYTHING.bat` from that folder to run the app.

You can keep the old folder as a backup or delete it once you’re happy with the new one.
