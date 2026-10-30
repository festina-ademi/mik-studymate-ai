import { useSyncExternalStore } from 'react';

import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage';

export const EXPLANATION_DEPTH_OPTIONS = ['line-by-line', 'blocks'] as const;
export type ExplanationDepth = (typeof EXPLANATION_DEPTH_OPTIONS)[number];

function isDepth(value: unknown): value is ExplanationDepth {
  return EXPLANATION_DEPTH_OPTIONS.some((option) => option === value);
}

export function readExplanationDepthPreference(): ExplanationDepth {
  const stored = readStorage(STORAGE_KEYS.codeExplanationDepth);
  return isDepth(stored) ? stored : 'line-by-line';
}

// One shared store, like `useLevel`: the workspace toggle and the long-code alert both change
// it, and every reader has to re-render with the same value.
const listeners = new Set<() => void>();
let current: ExplanationDepth = readExplanationDepthPreference();

export function writeExplanationDepthPreference(value: ExplanationDepth): void {
  current = value;
  writeStorage(STORAGE_KEYS.codeExplanationDepth, value);
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

/** How finely code explanations break the source down; persisted, line-by-line by default. */
export function useExplanationDepth(): {
  depth: ExplanationDepth;
  setDepth: (value: ExplanationDepth) => void;
} {
  const depth = useSyncExternalStore(subscribe, () => current);
  return { depth, setDepth: writeExplanationDepthPreference };
}
