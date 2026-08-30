# The Two Paths: Repo ↔ Local

The **repo** (Origin: `MrBeeboh/Atom-Chat`) is the **source of truth**. Your local folder is where you edit and test.

Clone: `https://origin.cursor.com/MrBeeboh/Atom-Chat.git`  
Browse: `https://cursor.com/codebase/MrBeeboh/Atom-Chat`

## Repo → Local (get latest)

```bash
git fetch origin main && git checkout main && git merge --ff-only origin/main
```

Or launch ATOM — `start-atom.sh` auto-syncs from Origin on start (unless `ATOM_SKIP_SYNC=1`).

## Local → Repo (save your work)

```bash
git checkout -b fix/my-change
# edit, test with ./start-atom.sh
git add -A && git commit -m "Describe change"
git push -u origin HEAD
```

Merge via PR on Origin.

## Summary

| Direction | Meaning | What to run |
|-----------|---------|-------------|
| **Repo → Local** | Get latest from Origin | `git pull origin main` or `./start-atom.sh` |
| **Local → Repo** | Save work to Origin | branch → commit → push → PR |

**Golden rule:** `origin/main` on Origin is the truth.
