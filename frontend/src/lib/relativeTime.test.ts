import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './relativeTime';

const NOW = new Date('2026-01-10T12:00:00.000Z').getTime();

describe('formatRelativeTime', () => {
  it('formats a couple of days in the past, in English', () => {
    const twoDaysAgo = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoDaysAgo, 'en', NOW)).toBe('2 days ago');
  });

  it('formats a couple of days in the past, in Albanian', () => {
    const twoDaysAgo = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoDaysAgo, 'sq', NOW)).toContain('2');
  });

  it('falls back to seconds for a very recent timestamp', () => {
    const justNow = new Date(NOW - 5000).toISOString();
    expect(formatRelativeTime(justNow, 'en', NOW)).toMatch(/second/);
  });

  it('picks the largest sensible unit (months, not weeks, for ~2 months)', () => {
    const twoMonthsAgo = new Date(NOW - 62 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoMonthsAgo, 'en', NOW)).toBe('2 months ago');
  });
});
