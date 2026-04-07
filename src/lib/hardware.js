/**
 * Browser-based hardware detection for optimizing defaults.
 * We can only access what the browser exposes (e.g. navigator.hardwareConcurrency).
 * GPU VRAM etc. are not available without WebGPU or a backend.
 */

/** @type {number} Logical CPU cores (best-effort; browser may round down for privacy). */
export function getCpuLogicalCores() {
  if (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number') {
    return Math.max(1, Math.min(256, navigator.hardwareConcurrency));
  }
  return 4;
}

/**
 * One-time detection result for use in stores/defaults.
 * @returns {{ cpuLogicalCores: number }}
 */
export function detectHardware() {
  return {
    cpuLogicalCores: getCpuLogicalCores(),
  };
}
