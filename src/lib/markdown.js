import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (_) {}
    }
    return hljs.highlightAuto(code).value;
  },
});

/**
 * @param {string} raw
 * @returns {string} HTML string (use with {@html} in Svelte, or sanitize first)
 */
export function renderMarkdown(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return marked.parse(raw, { async: false });
}

/**
 * Split assistant content into thinking vs answer using think/reasoning/thought tags.
 * @param {string} raw
 * @returns {{ type: 'thinking'|'answer', html: string }[]} Empty if no thinking block found
 */
export function splitThinkingAndAnswer(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const thinkRe = /<(?:think|reasoning|thought)>([\s\S]*?)<\/(?:think|reasoning|thought)>/gi;
  const parts = [];
  let lastEnd = 0;
  let m;
  while ((m = thinkRe.exec(raw)) !== null) {
    if (m.index > lastEnd) {
      const answer = raw.slice(lastEnd, m.index).trim();
      if (answer) parts.push({ type: 'answer', html: renderMarkdown(answer) });
    }
    const thinking = m[1].trim();
    if (thinking) parts.push({ type: 'thinking', html: renderMarkdown(thinking) });
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd === 0) {
    const open = raw.match(/<(?:think|reasoning|thought)>([\s\S]*)$/i);
    if (open && !/<\/(?:think|reasoning|thought)>/i.test(raw.slice(open.index))) {
      const thinking = open[1].trim();
      return thinking ? [{ type: 'thinking', html: renderMarkdown(thinking) }] : [];
    }
    return [];
  }
  const tail = raw.slice(lastEnd).trim();
  if (!tail) return parts;
  // Unclosed think after the answer must not swallow the posted reply.
  const openThink = tail.search(/<(?:think|reasoning|thought)>/i);
  if (openThink >= 0 && !/<\/(?:think|reasoning|thought)>/i.test(tail.slice(openThink))) {
    const before = tail.slice(0, openThink).trim();
    if (before) parts.push({ type: 'answer', html: renderMarkdown(before) });
    return parts;
  }
  parts.push({ type: 'answer', html: renderMarkdown(tail) });
  return parts;
}

/**
 * Drop hidden chain-of-thought so follow-up API turns stay small.
 * The UI still shows thinking from stored message content.
 * @param {string} raw
 * @returns {string}
 */
export function stripThinkingBlocks(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  return raw.replace(/<(?:think|reasoning|thought)>[\s\S]*?<\/(?:think|reasoning|thought)>/gi, '').trim();
}
