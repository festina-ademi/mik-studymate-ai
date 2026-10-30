/** localStorage keys used by the app. */
export const STORAGE_KEYS = {
  language: 'studymate.language',
  theme: 'studymate.theme',
  level: 'studymate.level',
  codeExplanationDepth: 'codeExplanationDepth',
  currentDocumentId: 'studymate.document.current',
  recentDocuments: 'studymate.documents.recent',
  documentState: 'studymate.document.state',
  chunksState: 'studymate.document.chunks',
  studyParticipantCode: 'studymate.study.participantCode',
  userProfile: 'userProfile',
  clientId: 'studymate.clientId',
} as const;

/** Read a value from localStorage; returns null when storage is unavailable. */
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a value to localStorage; silently does nothing when storage is unavailable. */
export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the preference simply won't persist.
  }
}

export function readJsonStorage<T>(key: string, fallback?: T): T | null {
  const raw = readStorage(key);
  if (!raw) {
    return fallback ?? null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback ?? null;
  }
}

export function writeJsonStorage(key: string, value: unknown): void {
  writeStorage(key, JSON.stringify(value));
}
