import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { vitePluginLocalDiskModels } from './scripts/vite-plugin-local-disk-models.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function gitRev() {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __GIT_REV__: JSON.stringify(gitRev()),
  },
  plugins: [svelte(), tailwindcss(), vitePluginLocalDiskModels()],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, 'src/lib'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    host: true, // listen on 0.0.0.0 so you can open the UI from other devices (e.g. bedroom mini at http://<this-pc-ip>:5173)
    proxy: {
      // Proxy for llama.cpp (llama-server) on port 8080
      '/api/llama': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/llama/, ''),
      },
      '/api/hf': {
        target: 'https://huggingface.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/hf/, ''),
      },
      '/api/ollama': {
        target: 'https://registry.ollama.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ollama/, ''),
      },
      '/api/search': {
        target: 'http://localhost:5174',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      '/api/health': { target: 'http://localhost:5174', changeOrigin: true },
      '/api/set-key': { target: 'http://localhost:5174', changeOrigin: true },
    },
  },
})
