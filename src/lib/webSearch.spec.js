import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  WEB_SEARCH_HINT,
  GROK_WEB_SEARCH_HINT,
  WEB_SEARCH_TOOLS,
  isPublicHttpUrl,
  isWebSearchToolName,
  executeWebSearchToolCalls,
} from './webSearch.js';

describe('web search tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tells the model it can search and must not deny internet', () => {
    expect(WEB_SEARCH_HINT).toMatch(/live internet/i);
    expect(WEB_SEARCH_HINT).toMatch(/web_search/);
    expect(WEB_SEARCH_HINT).toMatch(/Never say you cannot access the internet/i);
    expect(GROK_WEB_SEARCH_HINT).toMatch(/web_search/);
    expect(WEB_SEARCH_TOOLS.map((t) => t.function.name)).toEqual(['web_search', 'fetch_page']);
  });

  it('rejects private and non-http URLs', () => {
    expect(isPublicHttpUrl('https://openrouter.ai/tencent/hy3')).toBe(true);
    expect(isPublicHttpUrl('http://example.com/a')).toBe(true);
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('https://localhost/secret')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1:8080/models')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1/')).toBe(false);
    expect(isPublicHttpUrl('not a url')).toBe(false);
  });

  it('runs web_search with the model query, not the chat message', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      expect(String(url)).toContain('/api/search?q=OpenRouter%20Hy3%20Ox%20Alpha');
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            title: 'Hy3 vs Ox Alpha',
            url: 'https://openrouter.ai/compare/tencent/hy3/stealth/ox-alpha',
            snippet: 'Hy3 262K context; Ox Alpha 1M context and free.',
          },
        ],
      };
    }));
    const { messages, actions } = await executeWebSearchToolCalls([
      {
        id: 'c1',
        function: { name: 'web_search', arguments: JSON.stringify({ query: 'OpenRouter Hy3 Ox Alpha' }) },
      },
    ]);
    expect(actions[0].ok).toBe(true);
    const payload = JSON.parse(messages[0].content);
    expect(payload.ok).toBe(true);
    expect(payload.query).toBe('OpenRouter Hy3 Ox Alpha');
    expect(payload.results[0].url).toContain('openrouter.ai/compare');
    expect(payload.results[0].snippet).toContain('262K');
  });

  it('does not treat unknown tools as web search', () => {
    expect(isWebSearchToolName('read_file')).toBe(false);
    expect(isWebSearchToolName('web_search')).toBe(true);
  });
});
