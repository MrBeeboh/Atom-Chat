/**
 * Web search via local Brave Search proxy. Key from Settings or BRAVE_API_KEY.
 */

// Fetch from backend search proxy
async function fetchViaProxy(query) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (res.status === 503) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Web search not configured. Add Brave API key in Settings.');
  }
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return await res.json();
}

/**
 * Search DuckDuckGo Lite (HTML) and return real search results (title, snippet, url).
 * This returns actual web results; the Instant Answer API often returns empty for most queries.
 */

async function searchDuckDuckGoLite(query) {
  const q = String(query || '').trim();
  if (!q) return [];


  const braveResults = await fetchViaProxy(q);
  if (!Array.isArray(braveResults)) return [];

  // Brave API: each result has { title, url, description, thumbnail, ... }
  const results = braveResults.slice(0, 5).map(r => ({
    title: r.title || '',
    url: r.url || '',
    thumbnail: r.thumbnail || ''
  })).filter(r => r.title && r.url);
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
      throw new Error('Web search unavailable. Add Brave key in Settings or click globe to retry.');
    }
  }

  const related = liteResults.map((r) => ({
    text: r.snippet ? `${r.title} — ${r.snippet}` : r.title,
    url: r.url,
    thumbnail: r.thumbnail
  }));

  return {
    abstract: liteResults[0]?.snippet || liteResults[0]?.title || '',
    abstractUrl: liteResults[0]?.url || '',
    abstractSource: '',
    related,
  };
}

/** Check if search proxy is running (health check). */
export async function checkSearchConnection() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 3000);
    const res = await fetch('/api/health', { signal: c.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, error: 'Health check failed' };
    const data = await res.json();
    return { ok: true, available: data.search_available, timestamp: data.timestamp };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Connection timeout' : err.message };
  }
}

/** Send Brave API key to search proxy (e.g. after pasting in Settings). */
export async function syncBraveKeyToProxy(key) {
  const k = (key || '').trim();
  if (k.length < 10) return;
  try {
    const res = await fetch('/api/set-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k, type: 'brave' }) });
    if (!res.ok) throw new Error(await res.text());
  } catch (err) { console.warn('[search]', err.message); }
}

/** Prime the backend; returns Promise<boolean> for UI. */
export function warmUpSearchConnection() {
  return checkSearchConnection().then((data) => data.ok && data.available === true);
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
      if (r.thumbnail) {
        lines.push(`${i + 1}. ${r.text}`);
        lines.push(`   ${r.url}`);
        lines.push(`   [Image: ${r.thumbnail}]`);
      } else {
        lines.push(`${i + 1}. ${r.text}`);
        lines.push(`   ${r.url}`);
      }
    });
  }
  if (lines.length <= 3) lines.push('', '(No results found for this query.)');
  return lines.join('\n');
}
