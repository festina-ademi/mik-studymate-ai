import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getHealth, type ApiError, type HealthResponse } from '../lib/api';

const HEALTH_POLL_MS = 30_000;

/** Poll the backend health endpoint. */
export function useHealth(): UseQueryResult<HealthResponse, ApiError> {
  return useQuery<HealthResponse, ApiError>({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: HEALTH_POLL_MS,
    retry: false,
  });
}
