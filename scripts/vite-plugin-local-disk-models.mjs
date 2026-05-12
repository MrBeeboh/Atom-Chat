/**
 * Dev-only: scan LM Studio + common model dirs for .gguf files so the UI can list them
 * even when the inference server only exposes one loaded model.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_FILES = 800
const MAX_DEPTH = 12

function walkGgufs(root, out, depth) {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break
    const p = path.join(root, e.name)
    if (e.isDirectory()) walkGgufs(p, out, depth + 1)
    else if (e.isFile() && e.name.endsWith('.gguf')) out.push(path.normalize(p))
  }
}

export function vitePluginLocalDiskModels() {
  return {
    name: 'atom-local-disk-models',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] || ''
        if (pathname !== '/api/atom-local-disk-models') return next()
        if (req.method !== 'GET') return next()

        const home = os.homedir()
        const roots = [
          path.join(home, '.lmstudio', 'models'),
          path.join(home, 'models'),
        ]
        const paths = []
        for (const root of roots) {
          if (!root || !fs.existsSync(root)) continue
          walkGgufs(root, paths, 0)
        }
        const unique = [...new Set(paths)].sort((a, b) => a.localeCompare(b))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ models: unique.map((id) => ({ id })) }))
      })
    },
  }
}
