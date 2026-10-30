/**
 * App-wide quota signals, raised by the API layer for every request (see `apiFetch` in `api.ts`)
 * so that one global modal and the usage badge can react without each caller handling them.
 */

/** What the backend's `429 quota_exceeded` response said. */
export interface QuotaExceededDetail {
  /** Whole hours until the quota resets at the user's local midnight (at least 1). */
  hoursRemaining: number;
  /** Which quota ran out: `gemini_call` (AI requests) or `upload`. */
  quota: string | null;
}

type Listener<T> = (detail: T) => void;

const exceededListeners = new Set<Listener<QuotaExceededDetail>>();
const usageListeners = new Set<Listener<void>>();

function subscribe<T>(listeners: Set<Listener<T>>, listener: Listener<T>): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Run `listener` whenever a request is rejected because a daily quota is used up. */
export function onQuotaExceeded(listener: Listener<QuotaExceededDetail>): () => void {
  return subscribe(exceededListeners, listener);
}

export function emitQuotaExceeded(detail: QuotaExceededDetail): void {
  exceededListeners.forEach((listener) => {
    listener(detail);
  });
}

/** Run `listener` after a request that may have used some of today's quota. */
export function onQuotaUsageChanged(listener: Listener<void>): () => void {
  return subscribe(usageListeners, listener);
}

export function emitQuotaUsageChanged(): void {
  usageListeners.forEach((listener) => {
    listener();
  });
}
