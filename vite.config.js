import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { vitePluginLocalDiskModels } from './scripts/vite-plugin-local-disk-models.mjs'
import { vitePluginDesktopHost } from './scripts/vite-plugin-desktop-host.mjs'
import { vitePluginArenaReport } from './scripts/vite-plugin-arena-report.mjs'
import { vitePluginOpenScadRender } from './scripts/vite-plugin-openscad-render.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function gitRev() {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; }
}

/** Fresh Nous Portal JWT from Hermes login. Used only to attach Authorization on the local /api/nous proxy. */
function readNousBearerFromHermes() {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.hermes', 'auth.json'), 'utf8');
    const nous = JSON.parse(raw)?.providers?.nous || {};
    const token = String(nous.agent_key || nous.access_token || '').trim();
    return token;
  } catch {
    return '';
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __GIT_REV__: JSON.stringify(gitRev()),
  },
  plugins: [svelte(), tailwindcss(), vitePluginLocalDiskModels(), vitePluginDesktopHost(), vitePluginArenaReport(__dirname), vitePluginOpenScadRender()],
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
      '/api/xai': {
        target: 'https://api.x.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/xai/, ''),
      },
      '/api/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/deepseek/, ''),
      },
      '/api/cerebras': {
        target: 'https://api.cerebras.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cerebras/, ''),
      },
      '/api/deepinfra': {
        target: 'https://api.deepinfra.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/deepinfra/, ''),
      },
      '/api/nous': {
        target: 'https://inference-api.nousresearch.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/nous/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const incoming = String(proxyReq.getHeader('Authorization') || '');
            if (/^Bearer\s+sk-/i.test(incoming)) return;
            const token = readNousBearerFromHermes();
            if (token) proxyReq.setHeader('Authorization', `Bearer ${token}`);
          });
        },
      },
      '/api/openrouter': {
        target: 'https://openrouter.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openrouter/, ''),
      },
      '/api/deepinfra': {
        target: 'https://api.deepinfra.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/deepinfra/, ''),
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
