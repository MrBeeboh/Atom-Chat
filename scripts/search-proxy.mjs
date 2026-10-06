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

function isPrivateHostname(hostname) {
    const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (!h) return true;
    if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '::') return true;
    if (h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
    if (h.includes(':')) return true;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
    return false;
}

function assertPublicHttpUrl(raw, base) {
    let u;
    try {
        u = base ? new URL(String(raw || ''), base) : new URL(String(raw || ''));
    } catch {
        const err = new Error('Invalid URL');
        err.status = 400;
        throw err;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        const err = new Error('Only http(s) URLs are allowed');
        err.status = 400;
        throw err;
    }
    if (isPrivateHostname(u.hostname)) {
        const err = new Error('That host is not allowed');
        err.status = 400;
        throw err;
    }
    return u;
}

function htmlToText(html) {
    const titleMatch = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
    const text = String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
    return { title, text };
}

async function fetchPublicPage(urlString) {
    let current = assertPublicHttpUrl(urlString).toString();
    for (let hop = 0; hop < 4; hop += 1) {
        const response = await fetch(current, {
            redirect: 'manual',
            headers: {
                'User-Agent': 'ATOM-Chat/1.0 (+local)',
                Accept: 'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1',
            },
            signal: AbortSignal.timeout(12000),
        });
        if (response.status >= 300 && response.status < 400) {
            const loc = response.headers.get('location');
            if (!loc) {
                const err = new Error('Redirect with no Location');
                err.status = 400;
                throw err;
            }
            current = assertPublicHttpUrl(loc, current).toString();
            continue;
        }
        return { response, finalUrl: current };
    }
    const err = new Error('Too many redirects');
    err.status = 400;
    throw err;
}

app.get('/api/search', async (req, res) => {
    const q = req.query.q;
    if (!q || !q.trim()) return res.status(400).json({ error: 'Missing query' });
    if (!BRAVE_API_KEY) return res.status(503).json({ error: 'Search unavailable', message: 'Set Brave API key in Settings or BRAVE_API_KEY env.' });
    try {
        const count = Math.min(10, Math.max(1, parseInt(String(req.query.count || '8'), 10) || 8));
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', q);
        url.searchParams.set('count', String(count));
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

app.get('/api/search/page', async (req, res) => {
    const raw = req.query.url;
    if (!raw || !String(raw).trim()) return res.status(400).json({ error: 'Missing url' });
    try {
        const { response, finalUrl } = await fetchPublicPage(raw);
        if (!response.ok) {
            return res.status(502).json({ error: `Upstream ${response.status}`, url: finalUrl });
        }
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('image/') || contentType.includes('audio/') || contentType.includes('video/') || contentType.includes('octet-stream')) {
            return res.status(400).json({ error: 'That URL is not a text page', url: finalUrl });
        }
        const rawBody = (await response.text()).slice(0, 200000);
        const { title, text } = htmlToText(rawBody);
        res.json({
            url: finalUrl,
            title,
            text: text.slice(0, 12000),
        });
    } catch (err) {
        const status = err?.status || 500;
        console.error('[search-proxy] fetch', err.message);
        res.status(status).json({ error: 'Fetch failed', message: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[search-proxy] http://0.0.0.0:${PORT}`);
    if (!BRAVE_API_KEY) console.log('[search-proxy] No Brave key – set in Settings or BRAVE_API_KEY');
});
