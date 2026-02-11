/**
 * DuckDuckGo search for ATOM: real web results via Lite HTML (not just Instant Answer).
 * No API key. Uses CORS proxy in the browser.
 */

const PROXIES = [
  (target) => `https://corsproxy.io/?${encodeURIComponent(target)}`,
  (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
];

const TIMEOUT_MS = 30000; // 30s – Lite HTML + proxy can be slow

/**
 * Fetch HTML from a URL via CORS proxy.
 * Uses a fresh timeout signal per attempt so the second proxy gets a full timeout.
 */
async function fetchViaProxy(targetUrl) {
  let lastErr;
  for (const proxyFn of PROXIES) {
    const signal =
      typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
    try {
      const url = proxyFn(targetUrl);
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const text = await res.text();
      // corsproxy returns the target body directly (HTML); allorigins returns JSON { contents: "..." }
      if (text.trim().startsWith('{')) {
        const parsed = JSON.parse(text);
        if (parsed.contents != null) return typeof parsed.contents === 'string' ? parsed.contents : JSON.parse(parsed.contents);
      }
      return text;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error('Failed to fetch');
}

/**
 * Search DuckDuckGo Lite (HTML) and return real search results (title, snippet, url).
 * This returns actual web results; the Instant Answer API often returns empty for most queries.
 */
async function searchDuckDuckGoLite(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  const targetUrl = 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q);
  const html = await fetchViaProxy(targetUrl);
  if (typeof html !== 'string') return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const results = [];
  const links = doc.querySelectorAll('a[href*="uddg="]');

  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/uddg=([^&]+)/);
    if (!m) continue;
    let realUrl = '';
    try {
      realUrl = decodeURIComponent(m[1].replace(/\+/g, ' '));
    } catch (_) {
      continue;
    }
    const title = (a.textContent || '').trim();
    if (!title || title.length > 500) continue;

    let snippet = '';
    const row = a.closest('tr');
    if (row?.nextElementSibling) {
      const nextRow = row.nextElementSibling;
      const snippetCell = nextRow.querySelector('.result-snippet') || nextRow.querySelector('td');
      if (snippetCell) snippet = (snippetCell.textContent || '').trim().slice(0, 400);
    }

    results.push({ title, snippet, url: realUrl });
    if (results.length >= 8) break;
  }

  // Fallback: regex extract from HTML if DOM gave nothing (Lite layout varies)
  if (results.length === 0) {
    const linkRe = /<a[^>]+href="[^"]*uddg=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRe.exec(html)) !== null && results.length < 8) {
      try {
        const url = decodeURIComponent(match[1].replace(/\+/g, ' '));
        const title = (match[2] || '').replace(/<[^>]+>/g, '').trim();
        if (title && url && url.startsWith('http')) results.push({ title, snippet: '', url });
      } catch (_) {}
    }
  }

  return results;
}

/**
 * Main search: use Lite HTML for real web results (used for chat).
 * @param {string} query - Search query
 * @returns {Promise<{ abstract: string, abstractUrl: string, abstractSource: string, related: Array<{ text: string, url: string }> }>}
 *   For compatibility we also return abstract/related; "related" is filled from Lite results.
 */
export async function searchDuckDuckGo(query) {
  const q = String(query || '').trim();
  if (!q) return { abstract: '', abstractUrl: '', abstractSource: '', related: [] };

  const liteResults = await searchDuckDuckGoLite(q);
  const related = liteResults.map((r) => ({
    text: r.snippet ? `${r.title} — ${r.snippet}` : r.title,
    url: r.url,
  }));

  return {
    abstract: liteResults[0]?.snippet || liteResults[0]?.title || '',
    abstractUrl: liteResults[0]?.url || '',
    abstractSource: '',
    related,
  };
}

/**
 * Prime the CORS proxy/connection so the first real search is more likely to succeed.
 * Call when the user enables web search (globe button); do not wait for Send.
 * Resolves with true if warm-up succeeded, false otherwise (non-throwing).
 */
export function warmUpSearchConnection() {
  const targetUrl = 'https://lite.duckduckgo.com/lite/?q=a';
  const WARMUP_TIMEOUT_MS = 15000;
  const signal =
    typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(WARMUP_TIMEOUT_MS) : undefined;
  const url = PROXIES[0](targetUrl);
  return fetch(url, { signal })
    .then((res) => (res.ok ? true : false))
    .catch(() => false);
}

/**
 * Format search result as a single string for the chat (user message).
 */
export function formatSearchResultForChat(query, result) {
  const lines = [
    'The user asked a question that required a web search. Use the following search results to answer. Base your answer on these results.',
    '',
    `Web search for: "${query}"`,
  ];
  if (result.abstract) {
    lines.push('');
    lines.push(result.abstract);
    if (result.abstractUrl) lines.push(`Source: ${result.abstractUrl}`);
  }
  if (result.related?.length) {
    lines.push('');
    lines.push('Search results:');
    result.related.slice(0, 8).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.text}`);
      lines.push(`   ${r.url}`);
    });
  }
  if (lines.length <= 3) lines.push('', '(No results found for this query.)');
  return lines.join('\n');
}
