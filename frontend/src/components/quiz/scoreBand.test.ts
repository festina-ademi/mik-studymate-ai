import { describe, expect, it } from 'vitest';

import { CELEBRATION_THRESHOLD, getScoreBand, shouldCelebrate } from './scoreBand';

describe('getScoreBand', () => {
  it.each([
    [0, 'newMaterial'],
    [30, 'newMaterial'],
    [39, 'newMaterial'],
    [40, 'gettingThere'],
    [50, 'gettingThere'],
    [59, 'gettingThere'],
    [60, 'onTrack'],
    [70, 'onTrack'],
    [74, 'onTrack'],
    [75, 'great'],
    [85, 'great'],
    [89, 'great'],
    [90, 'excellent'],
    [100, 'excellent'],
  ] as const)('maps %i%% to the %s band', (percentage, expected) => {
    expect(getScoreBand(percentage)).toBe(expected);
  });

  it('clamps out-of-range and non-finite input instead of throwing', () => {
    expect(getScoreBand(-10)).toBe('newMaterial');
    expect(getScoreBand(150)).toBe('excellent');
    expect(getScoreBand(Number.NaN)).toBe('newMaterial');
  });
});

describe('shouldCelebrate', () => {
  it.each([
    [100, false, true],
    [90, false, true],
    [75, false, true],
    [74, false, false],
    [50, false, false],
    [0, false, false],
  ] as const)(
    'at %i%% with prefers-reduced-motion=%s, celebrate=%s',
    (percentage, prefersReducedMotion, expected) => {
      expect(shouldCelebrate(percentage, prefersReducedMotion)).toBe(expected);
    },
  );

  it('never celebrates under prefers-reduced-motion, even at a perfect score', () => {
    expect(shouldCelebrate(100, true)).toBe(false);
  });

  it('the celebration threshold matches the "great" band boundary (75%)', () => {
    expect(CELEBRATION_THRESHOLD).toBe(75);
  });
});
