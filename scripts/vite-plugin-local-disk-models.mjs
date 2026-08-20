/**
 * Dev-only: scan LM Studio + common model dirs for .gguf files so the UI can list them
 * even when the inference server only exposes one loaded model.
 * Projector files (mmproj-*.gguf) are not chat models; they are attached as siblings.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_FILES = 800
const MAX_DEPTH = 12
const PREFERRED_MMPROJ = ['mmproj-F16.gguf', 'mmproj-BF16.gguf', 'mmproj-F32.gguf']

function isMmprojName(name) {
  return /^mmproj/i.test(name)
}

function siblingMmproj(ggufPath) {
  const dir = path.dirname(ggufPath)
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return null
  }
  for (const name of PREFERRED_MMPROJ) {
    if (entries.includes(name)) return path.join(dir, name)
  }
  const hit = entries.find((n) => isMmprojName(n) && n.endsWith('.gguf'))
  return hit ? path.join(dir, hit) : null
}

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
    else if (e.isFile() && e.name.endsWith('.gguf') && !isMmprojName(e.name)) out.push(path.normalize(p))
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
        const models = unique.map((id) => {
          const mmproj = siblingMmproj(id)
          return mmproj ? { id, mmproj, vision: true } : { id }
        })
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ models }))
      })
    },
  }
}
