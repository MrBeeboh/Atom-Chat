# Git Workflow (Source of Truth + Local Real-Time Testing)

This project uses **Cursor Origin (`origin`) as the source of truth**.

Remote: `https://origin.cursor.com/MrBeeboh/Atom-Chat.git`  
Browse: `https://cursor.com/codebase/MrBeeboh/Atom-Chat`

You always test locally (for example with `npm run dev`), but you do code changes on short-lived branches and only merge to `main` when verified.

## One-time setup

Sign in before the first push/pull:

```bash
origin auth login
```

Repo-local git settings (already applied):

- `pull.ff=only`
- `fetch.prune=true`
- `push.autosetupremote=true`
- `rebase.autostash=true`

## Daily workflow

### 1) Sync local `main`

```bash
git fetch origin main && git checkout main && git merge --ff-only origin/main
```

### 2) Start a branch for one task

```bash
git checkout -b fix/short-description
```

### 3) Work and test locally

```bash
./start-atom.sh
# or: npm run dev
```

### 4) Save progress

```bash
git add -A && git commit -m "Describe change" && git push -u origin HEAD
```

### 5) Merge when done

Open a PR on Origin and merge to `main`.

## Golden rules

- `origin/main` on Origin is the official truth.
- Never do new work directly on `main`.
- One branch per task.
