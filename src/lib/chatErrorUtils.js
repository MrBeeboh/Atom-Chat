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
    message.includes('Error loading model')
  );
}