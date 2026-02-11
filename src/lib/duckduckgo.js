/**
 * DuckDuckGo search for ATOM: real web results via Lite HTML (not just Instant Answer).
 * No API key. Uses CORS proxy in the browser.
 */

/**
 * CORS proxies for DuckDuckGo Lite. Browser can't fetch DDG directly (CORS).
 * We try each in order; if one is down the next is used automatically.
 * Tested 2026-02-09:
 *   corsproxy.org  → 200 OK (returns HTML body directly)
 *   allorigins /get → 200 OK (returns JSON { contents: "..." })
 *   corsproxy.io   → 403 DEAD
 *   allorigins /raw → 520 DEAD
 */
const PROXIES = [
  { url: (target) => `https://corsproxy.org/?url=${encodeURIComponent(target)}`, json: false },
  { url: (target) => `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`, json: true },
];

const TIMEOUT_MS = 30000; // 30s – Lite HTML + proxy can be slow

/**
 * Fetch HTML from a URL via CORS proxy.
 * Tries each proxy in order; each gets a fresh timeout so a slow/dead proxy
 * doesn't eat the budget for the next one.
 */
async function fetchViaProxy(targetUrl) {
  let lastErr;
  for (const proxy of PROXIES) {
    const signal =
      typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
    try {
      const url = proxy.url(targetUrl);
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const text = await res.text();
      if (proxy.json) {
        // allorigins /get returns JSON { contents: "<html>..." }
        try {
          const parsed = JSON.parse(text);
          if (parsed.contents != null) return String(parsed.contents);
        } catch (_) {
          return text; // fallback: treat as raw
        }
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

  // Retry once on failure: first attempt may fail on cold proxy connection.
  let liteResults;
  try {
    liteResults = await searchDuckDuckGoLite(q);
  } catch (firstErr) {
    // Wait briefly, then retry the full proxy chain.
    await new Promise((r) => setTimeout(r, 1500));
    try {
      liteResults = await searchDuckDuckGoLite(q);
    } catch (secondErr) {
      throw new Error('Web search failed after retry. Check your internet connection and click the globe to reconnect.');
    }
  }

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
 * Prime the CORS proxy/connection when the user turns on web search (globe click).
 * Tries first proxy, then second on failure, so one down proxy doesn't block.
 * Resolves with true if warm-up succeeded, false otherwise (non-throwing).
 */
export function warmUpSearchConnection() {
  const targetUrl = 'https://lite.duckduckgo.com/lite/?q=a';
  const WARMUP_TIMEOUT_MS = 12000;
  const getSignal = typeof AbortSignal?.timeout === 'function' ? () => AbortSignal.timeout(WARMUP_TIMEOUT_MS) : () => undefined;
  function tryProxy(proxy) {
    const url = proxy.url(targetUrl);
    return fetch(url, { signal: getSignal() }).then((res) => {
      if (!res.ok) throw new Error(res.status);  // MUST reject so .catch tries next proxy
      return true;
    });
  }
  // Try first proxy; if it fails (network error OR non-200), try second.
  // Overall timeout: whichever finishes first, or false after 15s hard cap.
  const attempt = tryProxy(PROXIES[0]).catch(() => tryProxy(PROXIES[1])).catch(() => false);
  const hardTimeout = new Promise((r) => setTimeout(() => r(false), 15000));
  return Promise.race([attempt, hardTimeout]);
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
