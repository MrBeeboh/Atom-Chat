/**
 * Pure helpers for Arena "Run all" gating (unit-tested; UI calls these before confirm).
 */

/**
 * @param {number} panelCount
 * @returns {('A'|'B'|'C'|'D')[]}
 */
export function activeArenaSlots(panelCount) {
  const n = Math.max(1, Math.min(4, Number(panelCount) || 1));
  /** @type {('A'|'B'|'C'|'D')[]} */
  const all = ['A', 'B', 'C', 'D'];
  return all.slice(0, n);
}

/**
 * @param {{
 *   panelCount: number,
 *   slotAIsJudge: boolean,
 *   modelIdsBySlot: Partial<Record<'A'|'B'|'C'|'D', string>>,
 *   isEligible?: (modelId: string) => boolean,
 *   isColumnVisible?: (slot: 'A'|'B'|'C'|'D') => boolean,
 * }} opts
 * @returns {{ pickedCount: number, eligibleCount: number }}
 */
export function arenaContestantCounts(opts) {
  const {
    panelCount,
    slotAIsJudge,
    modelIdsBySlot,
    isEligible = () => true,
    isColumnVisible = () => true,
  } = opts;
  let pickedCount = 0;
  let eligibleCount = 0;
  for (const slot of activeArenaSlots(panelCount)) {
    if (slotAIsJudge && slot === 'A') continue;
    if (!isColumnVisible(slot)) continue;
    const id = modelIdsBySlot?.[slot];
    if (!id) continue;
    pickedCount += 1;
    if (isEligible(id)) eligibleCount += 1;
  }
  return { pickedCount, eligibleCount };
}

/**
 * Streaming flag is stuck with no active arena work (e.g. aborted chat).
 * @param {{
 *   isStreaming: boolean,
 *   runAllActive?: boolean,
 *   anySlotRunning?: boolean,
 *   arenaTransitionPhase?: string | null,
 *   judgmentInFlight?: boolean,
 * }} input
 */
export function isStaleArenaStreaming(input) {
  if (!input.isStreaming) return false;
  if (input.runAllActive) return false;
  if (input.anySlotRunning) return false;
  if (input.arenaTransitionPhase) return false;
  if (input.judgmentInFlight) return false;
  return true;
}

/**
 * User-visible reason Run all cannot start, or null if it may proceed (incl. stale stream recovery).
 * @param {{
 *   questionCount: number,
 *   pickedCount: number,
 *   eligibleCount: number,
 *   isStreaming: boolean,
 *   runAllActive?: boolean,
 *   anySlotRunning?: boolean,
 *   arenaTransitionPhase?: string | null,
 *   judgmentInFlight?: boolean,
 * }} input
 * @returns {string | null}
 */
export function getRunAllBlockReason(input) {
  if (input.runAllActive) return null;

  const q = Number(input.questionCount) || 0;
  if (q < 2) {
    if (q === 0) return 'Load at least two questions before using Run all.';
    return 'Run all needs at least two questions in the set.';
  }

  if ((input.eligibleCount ?? 0) === 0) {
    if ((input.pickedCount ?? 0) > 0) {
      return 'The selected cloud providers are not funded for this startup, so Run all cannot start.';
    }
    return 'Select at least one visible model (A–D) before Run all. Hidden columns are skipped.';
  }

  if (
    input.isStreaming &&
    !isStaleArenaStreaming(input)
  ) {
    return 'A run is already in progress. Wait for it to finish or use Stop.';
  }

  return null;
}

/**
 * Short tooltip for the Run all control.
 * @param {Parameters<typeof getRunAllBlockReason>[0]} input
 */
export function getRunAllButtonTitle(input) {
  const block = getRunAllBlockReason(input);
  if (block) return block;
  if (isStaleArenaStreaming(input)) {
    return 'Run every question in order (will clear a stuck run state first)';
  }
  return 'Run every question in order; judge scores after each';
}

/**
 * Mirrors sendUserMessage's streaming guard: blocked when isStreaming unless internalRun.
 * @param {{ text?: string, isStreaming: boolean, sendOpts?: { internalRun?: boolean } }} input
 */
export function isArenaSendBlockedByStreamingGuard(input) {
  const text = input.text;
  if (!text || !String(text).trim()) return true;
  const internalRun = input.sendOpts?.internalRun === true;
  return !internalRun && input.isStreaming;
}

/**
 * sendUserMessage opts for Round-mode Run All (loop owns isStreaming via isStreaming.set(true)).
 * @returns {{ internalRun: true }}
 */
export function arenaRoundRunAllSendOpts() {
  return { internalRun: true };
}
