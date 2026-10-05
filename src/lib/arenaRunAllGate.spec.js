import { describe, it, expect } from 'vitest';
import {
  activeArenaSlots,
  arenaContestantCounts,
  arenaRoundRunAllSendOpts,
  getRunAllBlockReason,
  getRunAllButtonTitle,
  isArenaSendBlockedByStreamingGuard,
  isStaleArenaStreaming,
} from './arenaRunAllGate.js';

describe('arenaRunAllGate', () => {
  describe('activeArenaSlots', () => {
    it('returns A only for panel count 1', () => {
      expect(activeArenaSlots(1)).toEqual(['A']);
    });
    it('caps at four slots', () => {
      expect(activeArenaSlots(99)).toEqual(['A', 'B', 'C', 'D']);
    });
  });

  describe('arenaContestantCounts', () => {
    it('skips judge slot A and hidden columns', () => {
      const { pickedCount, eligibleCount } = arenaContestantCounts({
        panelCount: 3,
        slotAIsJudge: true,
        modelIdsBySlot: { A: 'judge', B: 'local-b', C: 'local-c' },
        isColumnVisible: (s) => s !== 'C',
        isEligible: (id) => id.startsWith('local'),
      });
      expect(pickedCount).toBe(1);
      expect(eligibleCount).toBe(1);
    });
  });

  describe('isStaleArenaStreaming', () => {
    it('detects streaming with no active work', () => {
      expect(
        isStaleArenaStreaming({ isStreaming: true, anySlotRunning: false, arenaTransitionPhase: null }),
      ).toBe(true);
    });
    it('is not stale while a slot is running', () => {
      expect(
        isStaleArenaStreaming({ isStreaming: true, anySlotRunning: true }),
      ).toBe(false);
    });
    it('is not stale during run all', () => {
      expect(
        isStaleArenaStreaming({ isStreaming: true, runAllActive: true }),
      ).toBe(false);
    });
  });

  describe('getRunAllBlockReason', () => {
    const base = {
      questionCount: 3,
      pickedCount: 2,
      eligibleCount: 2,
      isStreaming: false,
      anySlotRunning: false,
      arenaTransitionPhase: null,
      judgmentInFlight: false,
    };

    it('requires at least two questions', () => {
      expect(getRunAllBlockReason({ ...base, questionCount: 1 })).toMatch(/two questions/i);
      expect(getRunAllBlockReason({ ...base, questionCount: 0 })).toMatch(/Load at least two/i);
    });

    it('requires eligible contestants', () => {
      expect(getRunAllBlockReason({ ...base, eligibleCount: 0, pickedCount: 0 })).toMatch(
        /Select at least one visible model/i,
      );
      expect(getRunAllBlockReason({ ...base, eligibleCount: 0, pickedCount: 1 })).toMatch(/not funded/i);
    });

    it('blocks active streaming but not stale streaming', () => {
      expect(
        getRunAllBlockReason({ ...base, isStreaming: true, anySlotRunning: true }),
      ).toMatch(/already in progress/i);
      expect(
        getRunAllBlockReason({ ...base, isStreaming: true, anySlotRunning: false }),
      ).toBe(null);
    });
  });

  describe('getRunAllButtonTitle', () => {
    it('uses block reason as title when blocked', () => {
      const title = getRunAllButtonTitle({
        questionCount: 1,
        pickedCount: 0,
        eligibleCount: 0,
        isStreaming: false,
      });
      expect(title).toMatch(/two questions/i);
    });
  });

  describe('Round Run All send contract', () => {
    it('arenaRoundRunAllSendOpts sets internalRun so streaming guard does not no-op', () => {
      expect(arenaRoundRunAllSendOpts()).toEqual({ internalRun: true });
    });

    it('isArenaSendBlockedByStreamingGuard matches sendUserMessage early-return', () => {
      const text = 'Question 1';
      expect(
        isArenaSendBlockedByStreamingGuard({
          text,
          isStreaming: true,
          sendOpts: arenaRoundRunAllSendOpts(),
        }),
      ).toBe(false);
      expect(
        isArenaSendBlockedByStreamingGuard({ text, isStreaming: true, sendOpts: {} }),
      ).toBe(true);
      expect(
        isArenaSendBlockedByStreamingGuard({ text, isStreaming: false, sendOpts: {} }),
      ).toBe(false);
    });
  });
});
