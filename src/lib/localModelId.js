/**
 * Map disk GGUF paths (Vite inventory / localStorage) to llama.cpp router model ids.
 *
 * After a restart, llama-server router lists models as relative ids under --models-dir
 * (often `folder/file.gguf` or the folder name for a multimodal bundle). ATOM used to
 * send the absolute path from ~/.lmstudio/models, which yields:
 *   model '/home/.../foo.gguf' not found
 */

const LMSTUDIO_MODELS_MARK = '/.lmstudio/models/';

/** True when this GGUF is a vision projector, not a chat checkpoint. */
export function isMmprojGguf(id) {
  if (!id || typeof id !== 'string') return false;
  const base = ggufBasename(id);
  return /^mmproj/i.test(base);
}

/** Lowercase filename (last path segment). */
export function ggufBasename(id) {
  if (!id || typeof id !== 'string') return '';
  const s = id.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return (i === -1 ? s : s.slice(i + 1));
}

export function ggufBasenameLower(id) {
  return ggufBasename(id).toLowerCase();
}

function posixNorm(id) {
  return String(id || '').replace(/\\/g, '/');
}

/**
 * Strip well-known model-root prefixes so an absolute path becomes a router-relative id.
 * @param {string} id
 * @returns {string}
 */
export function diskPathToRouterRelativeId(id) {
  if (!id || typeof id !== 'string') return id;
  const norm = posixNorm(id);
  const lower = norm.toLowerCase();
  const mark = LMSTUDIO_MODELS_MARK;
  const idx = lower.indexOf(mark);
  if (idx !== -1) return norm.slice(idx + mark.length);
  return norm.startsWith('/') || /^[A-Za-z]:\//.test(norm) ? ggufBasename(norm) : id;
}

/**
 * Whether two local model ids refer to the same GGUF / router entry.
 * Matches full path, basename, relative suffix, or parent folder (multimodal bundle).
 */
export function localModelIdsMatch(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  const na = posixNorm(a);
  const nb = posixNorm(b);
  if (na === nb) return true;
  const la = na.toLowerCase();
  const lb = nb.toLowerCase();
  if (la === lb) return true;
  const ba = ggufBasenameLower(a);
  const bb = ggufBasenameLower(b);
  if (ba && ba === bb && ba.endsWith('.gguf')) return true;
  if (la.endsWith('/' + lb) || lb.endsWith('/' + la)) return true;
  const relA = diskPathToRouterRelativeId(a);
  const relB = diskPathToRouterRelativeId(b);
  if (relA && relB && relA.toLowerCase() === relB.toLowerCase()) return true;
  const parentA = parentDirName(relA || na);
  const parentB = parentDirName(relB || nb);
  if (parentA && (parentA.toLowerCase() === lb || parentA.toLowerCase() === ggufBasenameLower(b))) return true;
  if (parentB && (parentB.toLowerCase() === la || parentB.toLowerCase() === ggufBasenameLower(a))) return true;
  return false;
}

function parentDirName(posixPath) {
  const s = posixNorm(posixPath);
  const i = s.lastIndexOf('/');
  if (i <= 0) return '';
  const parent = s.slice(0, i);
  const j = parent.lastIndexOf('/');
  return j === -1 ? parent : parent.slice(j + 1);
}

function scoreInventoryMatch(wanted, candidate) {
  const nw = posixNorm(wanted);
  const nc = posixNorm(candidate);
  const lw = nw.toLowerCase();
  const lc = nc.toLowerCase();
  if (lw === lc) return 100;
  const rel = diskPathToRouterRelativeId(wanted);
  if (rel && rel.toLowerCase() === lc) return 90;
  if (lw.endsWith('/' + lc)) return 80;
  if (lc.endsWith('/' + ggufBasenameLower(wanted)) && ggufBasenameLower(wanted).endsWith('.gguf')) return 70;
  if (ggufBasenameLower(wanted).endsWith('.gguf') && ggufBasenameLower(wanted) === ggufBasenameLower(candidate)) return 60;
  const parent = parentDirName(rel || nw);
  if (parent && parent.toLowerCase() === lc) return 50;
  if (localModelIdsMatch(wanted, candidate)) return 40;
  return 0;
}

/**
 * Pick the inventory / router id that llama-server will actually accept for `wanted`.
 * @param {string} wanted - Selected id (often an absolute disk path)
 * @param {string[]} inventoryIds - Ids from GET /models plus disk scan
 * @returns {string} Best matching inventory id, or a relative fallback
 */
export function pickInventoryModelId(wanted, inventoryIds) {
  if (!wanted || typeof wanted !== 'string') return wanted;
  const ids = (inventoryIds || []).filter((id) => typeof id === 'string' && id.trim() && !isMmprojGguf(id));
  let best = null;
  let bestScore = 0;
  for (const id of ids) {
    const score = scoreInventoryMatch(wanted, id);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  if (best) return best;
  const rel = diskPathToRouterRelativeId(wanted);
  return rel || wanted;
}

/**
 * True when a disk GGUF is already represented by a server/router id.
 * @param {string} diskId
 * @param {string[]} serverIds
 */
export function diskPathCoveredByServer(diskId, serverIds) {
  if (!diskId || !Array.isArray(serverIds) || serverIds.length === 0) return false;
  return serverIds.some((sid) => localModelIdsMatch(diskId, sid));
}
