/** Generate a simple unique id */
export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Format date for sidebar list */
export function formatTime(date) {
  const d = typeof date === 'number' ? new Date(date) : date;
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString();
}

/** Group conversations by date: Today, Yesterday, This week, Older */
export function groupByDate(conversations) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400_000;
  const weekAgo = today - 7 * 86400_000;

  const groups = { today: [], yesterday: [], week: [], older: [] };
  for (const c of conversations || []) {
    const ts = c.updatedAt ?? c.createdAt ?? 0;
    if (ts >= today) groups.today.push(c);
    else if (ts >= yesterday) groups.yesterday.push(c);
    else if (ts >= weekAgo) groups.week.push(c);
    else groups.older.push(c);
  }
  return groups;
}
