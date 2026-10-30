import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
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

/**
 * Build a Response mimicking the backend's summary/explanation SSE streaming format: a single
 * `token` event carrying the whole JSON payload's text, then `done` (see
 * `SummaryResponse.stream_response`/`ExplanationResponse.stream_response` in
 * `app/services/summary.py`, and `consumeJsonStream` in `lib/api.ts` which parses it). Real
 * requests split the text into many small chunks; tests only need the parsing path exercised, so
 * one chunk is enough.
 */
export function sseJsonResponse(payload: unknown): Response {
  const body = `event: token\ndata: ${JSON.stringify({ text: JSON.stringify(payload) })}\n\nevent: done\ndata: {}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
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

/** Render a single component with the query provider the app always supplies. */
export function renderWithQueryClient(ui: ReactElement): RenderResult {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);
}
