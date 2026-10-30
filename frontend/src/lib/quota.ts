import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { ApiError, getQuota, type QuotaOverview } from './api';
import { onQuotaUsageChanged } from './quotaEvents';

export const QUOTA_QUERY_KEY = ['quota'] as const;

/** Re-checks usage now and then, since a streamed answer is counted once its first piece arrives. */
const QUOTA_REFRESH_INTERVAL_MS = 30_000;

/** Whether `error` is the daily quota rejection (not the general per-minute rate limit). */
export function isQuotaExceeded(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === 'quota_exceeded';
}

export type QuotaTone = 'success' | 'warning' | 'error';

/** Green below 70% of the limit, orange from 70% to 90%, red from 90%. */
export function quotaTone(used: number, limit: number): QuotaTone {
  const share = limit > 0 ? used / limit : 1;
  if (share >= 0.9) return 'error';
  if (share >= 0.7) return 'warning';
  return 'success';
}

/** Today's AI-request and upload usage (`undefined` while loading or if unavailable). */
export function useQuota(): QuotaOverview | undefined {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: QUOTA_QUERY_KEY,
    queryFn: getQuota,
    refetchInterval: QUOTA_REFRESH_INTERVAL_MS,
    // A stale count is harmless (the backend enforces the limits), so don't retry noisily.
    retry: false,
  });
  useEffect(
    () =>
      onQuotaUsageChanged(() => {
        void queryClient.invalidateQueries({ queryKey: QUOTA_QUERY_KEY });
      }),
    [queryClient],
  );
  return data;
}
