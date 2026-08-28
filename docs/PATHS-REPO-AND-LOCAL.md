# The Two Paths: Repo ↔ Local

The **repo** (Origin: `MrBeeboh/Atom-Chat`) is the **source of truth**. Your **local** folder (`C:\CURSOR\AtomUI`) is where you (and tools like Cursor) edit and test. These two paths keep them in sync.

Clone URL: `https://origin.cursor.com/MrBeeboh/Atom-Chat.git`  
Browse: `https://cursor.com/codebase/MrBeeboh/Atom-Chat`

---

## Path 1: Repo → Local (get latest)

**When:** You want the latest from Origin on your machine (e.g. start of day, or after someone else pushed).

**From the project root in PowerShell:**

```powershell
.\scripts\sync-master.ps1
```

This fetches from Origin, checks out `main`, and fast-forwards it. Your local `main` then matches the repo.

---

## Path 2: Local → Repo (save your work to Origin)

**When:** You’ve made changes (or Cursor did) and you want them in the repo.

**Recommended workflow:** Use a branch, then merge to `main` and push. From the project root:

1. **Start a branch** (do this once per task):
   ```powershell
   .\scripts\start-work.ps1 -BranchName fix/my-change
   ```

2. **Work and test locally** (e.g. `npm run dev`). Edit, test, repeat.

3. **Save progress** (commit + push to Origin). Run as often as you like:
   ```powershell
   .\scripts\save-work.ps1 -Message "Describe what you did"
   ```

4. **When you’re done and tests pass**, merge into `main` and update the repo:
   ```powershell
   .\scripts\finish-work.ps1
   ```
   This merges your branch into `main` and pushes `main` to Origin.

---

## Summary

| Direction   | Meaning              | What to run |
|------------|----------------------|-------------|
| **Repo → Local** | Get latest from Origin | `.\scripts\sync-master.ps1` |
| **Local → Repo** | Save work to Origin    | Branch → `save-work.ps1` (often) → `finish-work.ps1` (when done) |

**Golden rule:** `origin/main` on Origin is the truth. Never do new work directly on `main`; use a branch, then merge when ready.

For the full workflow (including recovery), see [GIT-WORKFLOW.md](./GIT-WORKFLOW.md).
