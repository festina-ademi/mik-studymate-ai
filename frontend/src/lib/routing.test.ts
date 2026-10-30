import { describe, expect, it } from 'vitest';

import { getStartRoute } from './routing';

describe('getStartRoute', () => {
  it('sends visitors without a profile to onboarding', () => {
    expect(getStartRoute()).toBe('/welcome');
  });

  it('sends visitors with a valid saved profile to the workspace', () => {
    window.localStorage.setItem(
      'userProfile',
      JSON.stringify({
        firstName: 'Festina',
        lastName: 'Ademi',
        birthYear: 2000,
        role: 'student',
        language: 'sq',
        level: 'beginner',
        completedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    expect(getStartRoute()).toBe('/workspace');
  });

  it('falls back to onboarding when the saved profile is malformed', () => {
    window.localStorage.setItem('userProfile', '{not valid json');
    expect(getStartRoute()).toBe('/welcome');

    window.localStorage.setItem('userProfile', JSON.stringify({ role: 'wizard' }));
    expect(getStartRoute()).toBe('/welcome');
  });
});
