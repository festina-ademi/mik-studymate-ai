import { useSyncExternalStore } from 'react';

import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage';

export const LEVEL_OPTIONS = ['beginner', 'intermediate', 'advanced'] as const;
export type StudyLevel = (typeof LEVEL_OPTIONS)[number];

function isLevel(value: unknown): value is StudyLevel {
  return LEVEL_OPTIONS.some((option) => option === value);
}

export function readLevelPreference(): StudyLevel {
  const stored = readStorage(STORAGE_KEYS.level);
  return isLevel(stored) ? stored : 'intermediate';
}

// One shared store rather than per-component state: the header's level toggle, the workspace and
// the onboarding form must all see the same level, and changing it in one place (e.g. the
// header) has to re-render the others.
const listeners = new Set<() => void>();
let current: StudyLevel = readLevelPreference();

export function writeLevelPreference(value: StudyLevel): void {
  current = value;
  writeStorage(STORAGE_KEYS.level, value);
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLevel(): {
  level: StudyLevel;
  setLevel: (value: StudyLevel) => void;
} {
  const level = useSyncExternalStore(subscribe, () => current);
  return { level, setLevel: writeLevelPreference };
}
