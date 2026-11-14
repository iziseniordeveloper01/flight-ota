'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Fares should not silently change under the user when they switch tabs.
        refetchOnWindowFocus: false,
        staleTime: 60_000,
        // One retry for transient failures. Not for 4xx (same request, same answer) and not for
        // timeouts (the user already waited ~30s; let them decide via the Retry button).
        retry: (failureCount, error) =>
          failureCount < 1 &&
          !(error instanceof ApiError && (error.isClientError || error.kind === 'timeout')),
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // One client per browser session (useState so React strict-mode re-renders don't replace it).
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>{children}</NuqsAdapter>
    </QueryClientProvider>
  );
}
