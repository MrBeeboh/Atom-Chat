/**
 * Enhanced LM Studio API client with resilience and error handling
 * @file api.js
 * @description LM Studio API client: list models, load/unload, chat (streaming and non-streaming).
 *
 * Endpoints: GET /api/v1/models, POST /api/v1/models/load, POST /api/v1/models/unload (per-instance),
 * POST /v1/chat/completions. Bulk eject: unload helper at http://localhost:8766 (POST /unload-all, runs lms unload --all).
 * Base URL: localStorage lmStudioBaseUrl or dev proxy /api/lmstudio or http://localhost:1234.
 */

const DEFAULT_BASE = typeof import.meta !== 'undefined' && import.meta.env?.DEV ? '/api/lmstudio' : 'http://localhost:1234';

/**
 * Retry configuration for API calls
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffFactor: 2,
};

/**
 * Enhanced error class for API failures
 */
class ApiError extends Error {
  constructor(message, status, originalError = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.originalError = originalError;
  }
}

/**
 * Sleep utility for delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate retry delay with exponential backoff and jitter
 */
function calculateRetryDelay(attempt, baseDelay = RETRY_CONFIG.baseDelay, maxDelay = RETRY_CONFIG.maxDelay) {
  const delay = Math.min(baseDelay * Math.pow(RETRY_CONFIG.backoffFactor, attempt), maxDelay);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.max(100, delay + jitter);
}

/**
 * Retry wrapper for API calls with exponential backoff
 */
async function withRetry(operation, options = {}) {
  const { maxRetries = RETRY_CONFIG.maxRetries, retryCondition } = options;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry on certain errors
      if (error.name === 'AbortError' || error.name === 'ApiError' && error.status >= 400 && error.status < 500) {
        throw error;
      }

      // Check custom retry condition
      if (retryCondition && !retryCondition(error)) {
        throw error;
      }

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        throw lastError;
      }

      // Wait before retrying
      const delay = calculateRetryDelay(attempt);
      await sleep(delay);
    }
  }
}

/**
 * Enhanced fetch with timeout and better error handling
 */
async function fetchWithTimeout(url, options = {}) {
  const { timeout = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new ApiError(
        HTTP :  - ,
        response.status
      );
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new ApiError('Request timeout', 408, error);
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(Network error: , 0, error);
  }
}
