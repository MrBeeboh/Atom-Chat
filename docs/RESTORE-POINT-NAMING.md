# Restore Point Naming Convention

Use **git tags** for restore points. Name them so you can tell what and when at a glance.

## Format

**`MMDDYYYY-HHMM-brief-description`**

- **MMDDYYYY** – date (e.g. `02142026` = February 14, 2026)
- **HHMM** – time in 24-hour form (e.g. `1405` = 2:05 PM)
- **brief-description** – short, lowercase, hyphenated summary of what changed

## Examples

- `02142026-1405-arena-panel-tabs-strip-icons` – Arena panel tabs and strip icons (chat/settings) update
- `02112026-0930-arena-polish` – Arena UI polish
- `02112026-0945-cockpit-arena-clean` – Cockpit + Arena only, clean slate

## Creating a restore point

1. Commit any changes you want included.
2. Create an annotated tag with the date, time, and description:

   ```bash
   git tag -a "MMDDYYYY-HHMM-brief-description" -m "Short description of what this restore point is."
   ```

3. (Optional) Push the tag: `git push origin <tagname>`

## Restoring to a restore point

```bash
git checkout MMDDYYYY-HHMM-brief-description
```

Or to list tags and pick one:

```bash
git tag -l
git checkout <tagname>
```

To get back to the latest work: `git checkout master` (or your main branch).
