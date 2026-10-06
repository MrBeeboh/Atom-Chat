/**
 * Auto-grow textarea sizing (Perplexity-style: stable height when empty, grow
 * with content up to a max). Extracted from ChatInput for testability.
 */

export const INPUT_HEIGHT_EMPTY = 72;
export const INPUT_HEIGHT_MAX = 200;

/** Resize a textarea to fit its content, clamped between `empty` and `max`. */
export function autoResizeTextarea(textareaEl, text, { empty = INPUT_HEIGHT_EMPTY, max = INPUT_HEIGHT_MAX } = {}) {
  if (!textareaEl) return;
  textareaEl.style.height = 'auto';
  const contentHeight = textareaEl.scrollHeight;
  const isEmpty = !String(text ?? '').trim();
  const targetHeight = isEmpty ? empty : Math.min(Math.max(contentHeight, empty), max);
  textareaEl.style.height = targetHeight + 'px';
}
