import { QueryClient } from '@tanstack/react-query';

/** Shared TanStack Query defaults. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false },
    },
  });
}
