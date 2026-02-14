# The Two Paths: Repo ↔ Local

The **repo** (GitHub: `MrBeeboh/lm-studio-ui`) is the **source of truth**. Your **local** folder (`C:\CURSOR\lm-studio-ui`) is where you (and tools like Cursor) edit and test. These two paths keep them in sync.

---

## Path 1: Repo → Local (get latest)

**When:** You want the latest from GitHub on your machine (e.g. start of day, or after someone else pushed).

**From the project root in PowerShell:**

```powershell
.\scripts\sync-master.ps1
```

This fetches from GitHub, checks out `master`, and fast-forwards it. Your local `master` then matches the repo.

---

## Path 2: Local → Repo (save your work to GitHub)

**When:** You’ve made changes (or Cursor did) and you want them in the repo.

**Recommended workflow:** Use a branch, then merge to `master` and push. From the project root:

1. **Start a branch** (do this once per task):
   ```powershell
   .\scripts\start-work.ps1 -BranchName fix/my-change
   ```

2. **Work and test locally** (e.g. `npm run dev`). Edit, test, repeat.

3. **Save progress** (commit + push to GitHub). Run as often as you like:
   ```powershell
   .\scripts\save-work.ps1 -Message "Describe what you did"
   ```

4. **When you’re done and tests pass**, merge into `master` and update the repo:
   ```powershell
   .\scripts\finish-work.ps1
   ```
   This merges your branch into `master` and pushes `master` to GitHub.

---

## Summary

| Direction   | Meaning              | What to run |
|------------|----------------------|-------------|
| **Repo → Local** | Get latest from GitHub | `.\scripts\sync-master.ps1` |
| **Local → Repo** | Save work to GitHub    | Branch → `save-work.ps1` (often) → `finish-work.ps1` (when done) |

**Golden rule:** `origin/master` on GitHub is the truth. Never do new work directly on `master`; use a branch, then merge when ready.

For the full workflow (including recovery), see [GIT-WORKFLOW.md](./GIT-WORKFLOW.md).
