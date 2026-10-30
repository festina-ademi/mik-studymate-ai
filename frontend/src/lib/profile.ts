import type { ApiLanguage } from './api';
import type { StudyLevel } from '../hooks/useLevel';
import { readJsonStorage, STORAGE_KEYS, writeJsonStorage } from './storage';

export type UserRole = 'student' | 'professional' | 'other';
export type Degree = 'bachelor' | 'master' | 'phd';

export const YEARS_OF_STUDY = ['year1', 'year2', 'year3', 'year4', 'year4plus'] as const;
export type YearOfStudy = (typeof YEARS_OF_STUDY)[number];

/** Year chips offered for a degree level, in display order. */
export const YEARS_BY_DEGREE: Record<Degree, YearOfStudy[]> = {
  bachelor: ['year1', 'year2', 'year3', 'year4'],
  master: ['year1', 'year2'],
  phd: ['year1', 'year2', 'year3', 'year4plus'],
};

/** The onboarding answers, stored under the `userProfile` localStorage key. */
export interface UserProfile {
  firstName: string;
  lastName: string;
  birthYear: number;
  role: UserRole;
  /** Free-text description, only when the role is "other". */
  roleDetail?: string;
  /** Student only. */
  city?: string;
  /** Student only. */
  university?: string;
  /** Student only. */
  degree?: Degree;
  /** Student only. */
  yearOfStudy?: YearOfStudy;
  /** Professional/other only. */
  fieldOfWork?: string;
  language: ApiLanguage;
  level: StudyLevel;
  completedAt: string;
}

function isProfile(value: unknown): value is UserProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.firstName === 'string' &&
    typeof candidate.lastName === 'string' &&
    typeof candidate.birthYear === 'number' &&
    (candidate.role === 'student' ||
      candidate.role === 'professional' ||
      candidate.role === 'other') &&
    (candidate.language === 'en' || candidate.language === 'sq') &&
    typeof candidate.level === 'string' &&
    typeof candidate.completedAt === 'string'
  );
}

/** Uppercase two-letter initials for the profile avatar, e.g. "Festina"/"Ademi" -> "FA". */
export function getInitials(firstName: string, lastName: string): string {
  return ((firstName[0] ?? '') + (lastName[0] ?? '')).toUpperCase();
}

/** The saved profile, or null when onboarding has not been completed (or the data is invalid). */
export function readUserProfile(): UserProfile | null {
  const stored = readJsonStorage<unknown>(STORAGE_KEYS.userProfile);
  return isProfile(stored) ? stored : null;
}

export function writeUserProfile(profile: UserProfile): void {
  writeJsonStorage(STORAGE_KEYS.userProfile, profile);
}

export function clearUserProfile(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEYS.userProfile);
  } catch {
    // Storage unavailable: nothing was saved in the first place.
  }
}
