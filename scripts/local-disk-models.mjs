/**
 * Scan common local directories for .gguf files so atom-chat can list models
 * even when the inference server only exposes one loaded model (router + no autoload).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const MAX_FILES = 1200
export const MAX_DEPTH = 14

/** Default roots scanned when ATOM_MODEL_DIRS is unset. */
export function defaultModelScanRoots() {
  const home = os.homedir()
  return [
    path.join(home, '.lmstudio', 'models'),
    path.join(home, 'models'),
    path.join(home, '.cache', 'huggingface', 'hub'),
    path.join(home, '.cache', 'llama.cpp'),
    path.join(home, 'Downloads'),
  ]
}

/** Parse ATOM_MODEL_DIRS (colon-separated paths) or fall back to defaults. */
export function resolveModelScanRoots(env = process.env) {
  const raw = (env.ATOM_MODEL_DIRS || env.ATOM_MODELS_DIR || '').trim()
  if (raw) {
    return raw
      .split(path.delimiter)
      .map((p) => p.trim())
      .filter(Boolean)
  }
  return defaultModelScanRoots()
}

function walkGgufs(root, out, depth, maxFiles = MAX_FILES, maxDepth = MAX_DEPTH) {
  if (out.length >= maxFiles || depth > maxDepth) return
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= maxFiles) break
    const p = path.join(root, e.name)
    if (e.isDirectory()) walkGgufs(p, out, depth + 1, maxFiles, maxDepth)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.gguf')) out.push(path.normalize(p))
  }
}

/**
 * @param {string[]} [roots]
 * @returns {{ id: string }[]}
 */
export function scanLocalGgufModels(roots = resolveModelScanRoots()) {
  const paths = []
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue
    walkGgufs(root, paths, 0)
  }
  const unique = [...new Set(paths)].sort((a, b) => a.localeCompare(b))
  return unique.map((id) => ({ id }))
}
