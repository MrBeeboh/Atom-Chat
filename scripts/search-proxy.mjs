// Secure Brave Search proxy - key from env or Settings UI (config/brave_key.txt)
import express from 'express';
import cors from 'cors';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');
const KEY_FILE = join(CONFIG_DIR, 'brave_key.txt');
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.SEARCH_PROXY_PORT || 5174;

function loadApiKey() {
    if (process.env.BRAVE_API_KEY && process.env.BRAVE_API_KEY.length > 10) return process.env.BRAVE_API_KEY;
    try {
        if (existsSync(KEY_FILE)) {
            const key = readFileSync(KEY_FILE, 'utf-8').trim();
            if (key && key.length > 10 && !key.includes('YOUR_')) return key;
        }
    } catch (e) { console.error('[search-proxy]', e.message); }
    return null;
}
let BRAVE_API_KEY = loadApiKey();

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', search_available: !!BRAVE_API_KEY, timestamp: new Date().toISOString() });
});

app.post('/api/set-key', (req, res) => {
    const { key, type } = req.body || {};
    if (!key || key.length < 10) return res.status(400).json({ error: 'Invalid API key' });
    if (type === 'brave') {
        BRAVE_API_KEY = key;
        try {
            if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
            writeFileSync(KEY_FILE, key, { mode: 0o600 });
        } catch (e) { console.error('[search-proxy]', e.message); }
        return res.json({ status: 'ok' });
    }
    res.status(400).json({ error: 'Unknown type' });
});

app.get('/api/search', async (req, res) => {
    const q = req.query.q;
    if (!q || !q.trim()) return res.status(400).json({ error: 'Missing query' });
    if (!BRAVE_API_KEY) return res.status(503).json({ error: 'Search unavailable', message: 'Set Brave API key in Settings or BRAVE_API_KEY env.' });
    try {
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', q);
        url.searchParams.set('count', '5');
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY },
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) return res.status(response.status).json({ error: `Brave API ${response.status}` });
        const data = await response.json();
        const results = (data.web?.results || []).map(r => ({ title: r.title || '', url: r.url || '', snippet: r.description || '', thumbnail: r.thumbnail?.src || '' }));
        res.json(results);
    } catch (err) {
        console.error('[search-proxy]', err.message);
        res.status(500).json({ error: 'Search failed', details: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[search-proxy] http://0.0.0.0:${PORT}`);
    if (!BRAVE_API_KEY) console.log('[search-proxy] No Brave key – set in Settings or BRAVE_API_KEY');
});
