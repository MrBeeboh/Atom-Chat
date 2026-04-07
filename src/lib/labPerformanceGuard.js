/**
 * @file labPerformanceGuard.js
 * @description Performance guard for AI Lab overlay. v1: returns default config only.
 * Future: when streaming FPS drops below threshold, return reduced animations, blur, update rate.
 * Overlay and stream reporter consume this so we can throttle or simplify without code changes.
 */

/**
 * @returns {{ animationsEnabled: boolean, blurIntensity: number, updateRateMs: number }}
 */
export function getLabPerformanceConfig() {
  return {
    animationsEnabled: true,
    blurIntensity: 1,
    updateRateMs: 100,
  };
}
