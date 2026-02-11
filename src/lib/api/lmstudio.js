import { get } from 'svelte/store';
import { lmStudioBaseUrl } from '../stores.js';

function getBaseUrl() {
  const url = get(lmStudioBaseUrl)?.trim() || '';
  return url || 'http://localhost:1234';
}

/**
 * @param {string} model
 * @param {Array} messages
 * @param {(chunk: string) => void} onChunk
 * @param {{ temperature?: number, max_tokens?: number, top_p?: number, top_k?: number, repeat_penalty?: number }} [options]
 * @returns {Promise<{ usage?: { completion_tokens?: number, prompt_tokens?: number }, elapsedMs: number }>}
 */
export async function sendMessage(model, messages, onChunk, options = {}) {
  const startTime = Date.now();
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'local-model',
      messages,
      stream: true,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
      ...(options.top_p != null && { top_p: options.top_p }),
      ...(options.top_k != null && { top_k: options.top_k }),
      ...(options.repeat_penalty != null && { repeat_penalty: options.repeat_penalty }),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const msg = body?.trim() ? `${response.status} ${response.statusText}: ${body.slice(0, 200)}` : `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(msg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  /** @type {{ completion_tokens?: number, prompt_tokens?: number } | undefined} */
  let usage;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            onChunk(content);
          }
          if (json.usage) {
            usage = json.usage;
          }
        } catch (_) {
          // Malformed SSE line; skip
        }
      }
    }
  }

  return { usage, elapsedMs: Date.now() - startTime };
}
