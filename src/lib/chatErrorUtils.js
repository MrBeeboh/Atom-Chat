/**
 * True when chat error indicates the local model is not loaded — sending again will likely fail.
 * @param {unknown} message
 * @returns {boolean}
 */
export function isModelLoadBlockingError(message) {
  if (message == null || typeof message !== 'string') return false;
  return (
    message.includes('Model failed to load') ||
    message.includes('Failed to load model') ||
    message.includes('Error loading model') ||
    message.includes('model is not loaded') ||
    message.includes('did not become ready')
  );
}

/**
 * Parse a chat API error response body and return a user-facing message.
 * Handles OpenAI-style `{ error: { message, type, code } }`, `{ message }`, and plain text.
 * Maps status + type to actionable guidance (e.g. 401 → check API key in Settings).
 * @param {number} status - HTTP status code
 * @param {string} bodyText - Raw response body
 * @param {string} [modelId] - Requested model id (e.g. grok:grok-4) to tailor cloud vs local hints
 * @returns {string} Message suitable for chatError / user display
 */
export function parseChatApiError(status, bodyText, modelId) {
  let apiMessage = '';
  let errorType = '';
  let code = '';
  const isCloud = modelId && String(modelId).includes(':');
  const cloudHint = isCloud
    ? ' Check Settings → Cloud APIs (Nous, DeepSeek, Grok, Cerebras, DeepInfra): confirm the key is correct, has no extra spaces, and is valid for the selected provider.'
    : '';

  if (bodyText && bodyText.trim()) {
    try {
      const json = JSON.parse(bodyText);
      const err = json.error ?? json;
      if (err && typeof err === 'object') {
        apiMessage = err.message ?? err.msg ?? '';
        errorType = err.type ?? err.error ?? '';
        code = err.code ?? '';
      } else if (typeof err === 'string') {
        apiMessage = err;
      } else if (typeof json.message === 'string') {
        apiMessage = json.message;
      }
    } catch (_) {
      apiMessage = bodyText.trim().slice(0, 200);
    }
  }

  apiMessage = typeof apiMessage === 'string' ? apiMessage.trim() : '';

  switch (status) {
    case 401:
      if (errorType === 'authentication_error' || code === 'invalid_request_error' || code === 'invalid_api_key' || /invalid|auth|key|unauthorized/i.test(apiMessage)) {
        return `Invalid API key.${cloudHint}`;
      }
      return apiMessage || `Authentication failed.${cloudHint}`;
    case 403:
      return apiMessage || `Access forbidden. Your key may not have permission for this model.${cloudHint}`;
    case 429:
      if (code === 'rate_limit_exceeded') return 'Too many requests. Please wait a moment and try again.';
      return apiMessage || 'Rate limit exceeded. Try again in a moment.';
    case 500:
    case 502:
    case 503:
      if (apiMessage) return apiMessage;
      if (bodyText && bodyText.trim()) {
        const t = bodyText.trim().slice(0, 500);
        return `The API server had an error (${status}). ${t}`;
      }
      return `The API server had an error (${status}). Try again later.`;
    case 400:
      if (code === 'model_not_found') return apiMessage || 'Model not found. Check the model name in Settings or try a different model.';
      if (code === 'context_length_exceeded' || /exceeds the available context size/i.test(apiMessage)) {
        return 'This chat is longer than the local model window. ATOM keeps recent turns only. Send again, or start a new chat.';
      }
      return apiMessage || 'Bad request. Check your request or try a different model.';
    default:
      return apiMessage || `Request failed (${status}). Try again or check Settings.`;
  }
}