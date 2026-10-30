import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, askTutorQuestion, getDocument } from '../lib/api';
import { onQuotaUsageChanged } from '../lib/quotaEvents';
import { QuotaExceededModal } from './QuotaExceededModal';

function quotaExceededResponse(hoursRemaining: number): Response {
  return Response.json(
    {
      error: {
        code: 'quota_exceeded',
        message_key: 'errors.quota_exceeded',
        details: { quota: 'gemini_call', used: 50, limit: 50, hours_remaining: hoursRemaining },
      },
      reset_at: '2026-10-22T00:00:00+02:00',
      hours_remaining: hoursRemaining,
    },
    { status: 429 },
  );
}

function stubFetchOnce(response: Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response)),
  );
}

describe('global quota interceptor', () => {
  it('opens the modal when any API call is rejected with quota_exceeded', async () => {
    stubFetchOnce(quotaExceededResponse(4));
    render(<QuotaExceededModal />);

    const error = await getDocument('doc-1').catch((caught: unknown) => caught);

    // The caller still gets the error, so its own state (loading, retry) stays correct.
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'quota_exceeded' });
    const modal = await screen.findByRole('alertdialog');
    expect(modal).toHaveTextContent('⏰ Daily quota reached');
    expect(modal).toHaveTextContent('See you in 4 hours. Your data has been saved.');
  });

  it('also catches a quota rejection of a streamed AI request', async () => {
    stubFetchOnce(quotaExceededResponse(1));
    render(<QuotaExceededModal />);

    await askTutorQuestion({
      documentId: 'doc-1',
      message: 'Why?',
      level: 'beginner',
      language: 'en',
      stream: true,
      onToken: () => undefined,
    }).catch(() => undefined);

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'See you in 1 hour. Your data has been saved.',
    );
  });

  it('closes the modal with the OK button', async () => {
    stubFetchOnce(quotaExceededResponse(4));
    const user = userEvent.setup();
    render(<QuotaExceededModal />);
    await getDocument('doc-1').catch(() => undefined);

    await user.click(await screen.findByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  it('ignores the general per-minute rate limit', async () => {
    stubFetchOnce(
      Response.json(
        { error: { code: 'rate_limited', details: { retry_after_seconds: 3 } } },
        { status: 429 },
      ),
    );
    render(<QuotaExceededModal />);

    await getDocument('doc-1').catch(() => undefined);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('sends the client id and time zone, and signals usage after AI requests', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ id: 'doc-1' })));
    vi.stubGlobal('fetch', fetchMock);
    const usage = vi.fn();
    const unsubscribe = onQuotaUsageChanged(usage);

    await getDocument('doc-1');
    expect(usage).not.toHaveBeenCalled();
    await askTutorQuestion({
      documentId: 'doc-1',
      message: 'Why?',
      level: 'beginner',
      language: 'en',
      onToken: () => undefined,
    }).catch(() => undefined);
    unsubscribe();

    expect(usage).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Client-Id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(headers['X-Timezone']).toBeTruthy();
    expect(headers.Accept).toBe('application/json');
  });
});
