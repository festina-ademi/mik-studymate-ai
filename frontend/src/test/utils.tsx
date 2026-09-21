import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import { App } from '../App';
import { createQueryClient } from '../lib/queryClient';

/** Replace ``fetch`` with a stub that answers every request with ``body``. */
export function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(body, { status }))),
  );
}

/** Render the whole app on ``path`` with fresh providers. */
export function renderApp(path = '/'): RenderResult {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
