/**
 * Dev-only: scan LM Studio + common model dirs for .gguf files so the UI can list them
 * even when the inference server only exposes one loaded model.
 */
import { scanLocalGgufModels } from './local-disk-models.mjs'

export function vitePluginLocalDiskModels() {
  return {
    name: 'atom-local-disk-models',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] || ''
        if (pathname !== '/api/atom-local-disk-models') return next()
        if (req.method !== 'GET') return next()

        const models = scanLocalGgufModels()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ models }))
      })
    },
  }
}
