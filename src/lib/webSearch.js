/**
 * Chat web tools: the model calls web_search / fetch_page; ATOM runs Brave + page fetch.
 * This is the real internet path. Do not stuff the user's whole message into a search query.
 */

import { parseToolArguments } from '$lib/desktopHost.js';
import { searchDuckDuckGo } from '$lib/duckduckgo.js';

export const WEB_SEARCH_HINT = [
  'You have live internet access through tools.',
  'web_search: search the public web. Pass a short keyword query (example: "OpenRouter Hy3 vs Ox Alpha pricing"), never the user\'s entire chat message.',
  'fetch_page: download one http(s) URL and read the page text. Use it when a search hit looks like the real source.',
  'Use these tools for current facts, prices, news, model comparisons, and anything you are not sure of.',
  'If results are off-topic, search again with a better query. Cite URLs you used.',
  'Never say you cannot access the internet, cannot browse, or that search results are only fed to you. You invoke the tools yourself.',
].join(' ');

export const GROK_WEB_SEARCH_HINT = [
  'You have live internet access through built-in web_search and x_search.',
  'Use them for current facts, prices, news, and comparisons.',
  'Search with a short query, not the user\'s entire message.',
  'Never say you cannot access the internet or cannot look things up.',
].join(' ');

export const WEB_SEARCH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the live public web. Use a short keyword query, not the user\'s whole message. Returns titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            description: 'Short search query, e.g. "Tencent Hy3 OpenRouter price context window"',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_page',
      description:
        'Fetch a public http(s) page and return extracted text. Use after web_search when you need the actual article or docs page.',
      parameters: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'Full http(s) URL to fetch' },
        },
      },
    },
  },
];

export const WEB_SEARCH_TOOL_NAMES = new Set(WEB_SEARCH_TOOLS.map((t) => t.function.name));

export function isWebSearchToolName(name) {
  return WEB_SEARCH_TOOL_NAMES.has(name);
}

export function isPublicHttpUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '::') return false;
  if (h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false;
  if (h.includes(':')) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return false;
  return true;
}

function toolResult(payload) {
  return JSON.stringify(payload);
}

export async function fetchPageForChat(url) {
  const target = String(url || '').trim();
  if (!isPublicHttpUrl(target)) {
    return { ok: false, error: 'Only public http(s) URLs can be fetched.' };
  }
  const res = await fetch(`/api/search/page?url=${encodeURIComponent(target)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.message || data.error || `Fetch failed: ${res.status}` };
  }
  return {
    ok: true,
    url: data.url || target,
    title: data.title || '',
    text: data.text || '',
  };
}

/**
 * Run web_search / fetch_page tool_calls. Unknown names are left for the caller.
 * @param {Array} toolCalls
 */
export async function executeWebSearchToolCalls(toolCalls) {
  const messages = [];
  const actions = [];
  for (const call of toolCalls || []) {
    const name = call.function?.name;
    const args = parseToolArguments(call.function?.arguments);
    if (!isWebSearchToolName(name)) continue;
    let payload;
    try {
      if (name === 'web_search') {
        const query = String(args.query || args.q || '').trim();
        if (!query) {
          payload = { ok: false, error: 'Missing query. Pass a short keyword search.' };
        } else {
          const result = await searchDuckDuckGo(query);
          payload = {
            ok: true,
            query,
            results: (result.related || []).map((r) => ({
              title: r.title || r.text || '',
              url: r.url || '',
              snippet: r.snippet || '',
            })),
          };
          if (!payload.results.length) {
            payload.note = 'No results. Try a shorter, more specific query.';
          }
        }
      } else {
        payload = await fetchPageForChat(args.url || args.href || '');
      }
    } catch (e) {
      payload = { ok: false, error: e?.message || 'Web tool failed.' };
    }
    actions.push({ name, query: args.query || '', url: args.url || payload.url || '', ok: payload.ok !== false });
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: toolResult(payload),
    });
  }
  return { messages, actions };
}
