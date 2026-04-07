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
  if (lastEnd === 0) return [];
  const tail = raw.slice(lastEnd).trim();
  if (tail) parts.push({ type: 'answer', html: renderMarkdown(tail) });
  return parts;
}
