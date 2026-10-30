import { afterEach, describe, expect, it } from 'vitest';

import { getInitials, readUserProfile, writeUserProfile, type UserProfile } from './profile';

const BASE_PROFILE: UserProfile = {
  firstName: 'Festina',
  lastName: 'Ademi',
  birthYear: 2000,
  role: 'student',
  city: 'prishtina',
  university: 'Universum International College',
  degree: 'bachelor',
  yearOfStudy: 'year3',
  language: 'en',
  level: 'intermediate',
  completedAt: '2026-01-01T00:00:00.000Z',
};

describe('getInitials', () => {
  it('uppercases the first letter of the first and last name', () => {
    expect(getInitials('festina', 'ademi')).toBe('FA');
  });

  it('tolerates a missing name without throwing', () => {
    expect(getInitials('', 'Ademi')).toBe('A');
    expect(getInitials('Festina', '')).toBe('F');
    expect(getInitials('', '')).toBe('');
  });
});

describe('userProfile storage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a full profile', () => {
    writeUserProfile(BASE_PROFILE);
    expect(readUserProfile()).toEqual(BASE_PROFILE);
  });

  it('rejects a stored profile missing the new name/birth year fields', () => {
    window.localStorage.setItem(
      'userProfile',
      JSON.stringify({
        role: 'student',
        language: 'en',
        level: 'intermediate',
        completedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(readUserProfile()).toBeNull();
  });
});
