/**
 * Microphone access: device enumeration, getUserMedia fallbacks, friendly errors.
 */

export const MIC_DEVICE_STORAGE_KEY = 'micDeviceId';

/** @param {unknown} error */
export function micErrorMessage(error) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const msg = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';

  if (name === 'NotFoundError' || /device not found/i.test(msg)) {
    return 'No microphone found. Plug in a mic, check system sound settings, or choose an input in Settings → Connection → Microphone.';
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone blocked. Allow mic access for this site in your browser settings, then try again.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Microphone is in use by another app. Close other apps using the mic and try again.';
  }
  if (name === 'OverconstrainedError') {
    return 'Selected microphone unavailable. Open Settings and pick a different input device.';
  }
  if (name === 'SecurityError') {
    return 'Microphone requires a secure context (HTTPS or localhost).';
  }
  return msg || 'Microphone access denied or unavailable';
}

/**
 * @returns {Promise<Array<{ deviceId: string, label: string, groupId: string }>>}
 */
export async function enumerateAudioInputs() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${i + 1}`,
      groupId: d.groupId,
    }));
}

/** Brief mic access so enumerateDevices returns human-readable labels. */
export async function requestMicPermissionForLabels() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return true;
  } catch {
    return false;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

export function getStoredMicDeviceId() {
  if (typeof localStorage === 'undefined') return '';
  return (localStorage.getItem(MIC_DEVICE_STORAGE_KEY) || '').trim();
}

/**
 * @param {string} [deviceId]
 * @param {MediaTrackConstraints} [extra]
 */
export function audioConstraints(deviceId, extra = {}) {
  const id = (deviceId || '').trim();
  if (id && id !== 'default') {
    return { audio: { deviceId: { exact: id }, ...extra } };
  }
  if (Object.keys(extra).length) return { audio: extra };
  return { audio: true };
}

function isPermissionError(error) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  return name === 'NotAllowedError' || name === 'PermissionDeniedError';
}

function isDeviceMissingError(error) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const msg = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  return name === 'NotFoundError' || name === 'OverconstrainedError' || /device not found/i.test(msg);
}

/**
 * Acquire a microphone stream, trying stored device, system default, then each listed input.
 * @param {string} [preferredDeviceId] Empty = browser default.
 * @param {MediaTrackConstraints} [extraAudioConstraints]
 * @returns {Promise<MediaStream>}
 */
export async function acquireMicStream(preferredDeviceId = getStoredMicDeviceId(), extraAudioConstraints = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone not supported in this browser');
  }

  const preferred = (preferredDeviceId || '').trim();
  /** @type {Error | DOMException | undefined} */
  let lastError;

  async function tryGet(constraints) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  if (preferred && preferred !== 'default') {
    try {
      return await tryGet(audioConstraints(preferred, extraAudioConstraints));
    } catch (e) {
      lastError = /** @type {Error} */ (e);
      if (isPermissionError(e)) throw e;
    }
  }

  try {
    return await tryGet(audioConstraints('', extraAudioConstraints));
  } catch (e) {
    lastError = /** @type {Error} */ (e);
    if (isPermissionError(e)) throw e;
    if (!isDeviceMissingError(e)) throw e;
  }

  const inputs = await enumerateAudioInputs();
  const tried = new Set([preferred].filter(Boolean));
  for (const dev of inputs) {
    if (!dev.deviceId || dev.deviceId === 'default' || tried.has(dev.deviceId)) continue;
    tried.add(dev.deviceId);
    try {
      const stream = await tryGet(audioConstraints(dev.deviceId, extraAudioConstraints));
      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.();
      if (settings?.deviceId && typeof localStorage !== 'undefined') {
        localStorage.setItem(MIC_DEVICE_STORAGE_KEY, settings.deviceId);
      }
      return stream;
    } catch (e) {
      lastError = /** @type {Error} */ (e);
      if (isPermissionError(e)) throw e;
    }
  }

  throw lastError || new DOMException('Requested device not found', 'NotFoundError');
}

/** @returns {string} */
export function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

/**
 * @param {MediaStream} stream
 * @param {string} [preferredMime]
 */
export function createMediaRecorder(stream, preferredMime) {
  const types = preferredMime
    ? [preferredMime]
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const mime of types) {
    if (mime && typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(mime)) {
      try {
        return new MediaRecorder(stream, { mimeType: mime });
      } catch {
        /* try next */
      }
    }
  }
  return new MediaRecorder(stream);
}
