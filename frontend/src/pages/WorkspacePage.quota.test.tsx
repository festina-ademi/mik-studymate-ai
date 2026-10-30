import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DocumentRecord } from '../lib/api';
import { readJsonStorage, STORAGE_KEYS, writeJsonStorage, writeStorage } from '../lib/storage';
import { renderApp } from '../test/utils';

function makeDocument(id: string, filename: string): DocumentRecord {
  return {
    id,
    filename,
    content_hash: `hash-${id}`,
    content_type: 'lecture',
    source_format: 'pdf',
    detected_language: 'en',
    size_bytes: 100,
    page_count: 1,
  };
}

const FIRST = makeDocument('doc-1', 'first.pdf');
const STALE = makeDocument('doc-2', 'stale.pdf');

function seedDocuments(): void {
  writeJsonStorage(
    STORAGE_KEYS.recentDocuments,
    [FIRST, STALE].map((document) => ({
      id: document.id,
      filename: document.filename,
      content_type: document.content_type,
      source_format: document.source_format,
      detected_language: document.detected_language,
      updatedAt: new Date().toISOString(),
    })),
  );
  writeStorage(STORAGE_KEYS.currentDocumentId, FIRST.id);
  writeJsonStorage(STORAGE_KEYS.documentState, { document: FIRST });
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** Stub the API: quota usage, uploads rejected by the quota, and deletes of unknown documents. */
function stubFetch(aiUsed: number, uploadsUsed = 0): ReturnType<typeof vi.fn<FetchMock>> {
  const resetAt = new Date(Date.now() + 5 * 3_600_000).toISOString();
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = urlOf(input);
    if (url.endsWith('/api/quota')) {
      return Promise.resolve(
        Response.json({
          ai_requests: { used: aiUsed, limit: 50, reset_at: resetAt },
          uploads: { used: uploadsUsed, limit: 5, reset_at: resetAt },
        }),
      );
    }
    if (url.endsWith('/api/documents/code') && init?.method === 'POST') {
      return Promise.resolve(
        Response.json(
          {
            error: {
              code: 'quota_exceeded',
              message_key: 'errors.quota_exceeded',
              details: {
                quota: 'upload',
                used: 5,
                limit: 5,
                reset_at: resetAt,
                hours_remaining: 5,
              },
            },
            reset_at: resetAt,
            hours_remaining: 5,
          },
          { status: 429 },
        ),
      );
    }
    // Everything else -- including DELETE of a document the backend no longer has -- is a 404.
    return Promise.resolve(Response.json({ error: { code: 'not_found' } }, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('workspace quota display', () => {
  it('shows the AI request badge with a colored progress bar and the reset tooltip', async () => {
    seedDocuments();
    stubFetch(23);
    renderApp('/workspace');

    const badge = await screen.findByTestId('ai-quota-badge');
    expect(badge).toHaveTextContent('✨ 23 of 50 requests today');
    const bar = within(badge).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '23');
    expect(bar).toHaveAttribute('aria-valuemax', '50');
    expect(bar.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByText('The quota resets at 00:00')).toBeInTheDocument();
  });

  it('turns the bar red near the limit', async () => {
    seedDocuments();
    stubFetch(47);
    renderApp('/workspace');

    const badge = await screen.findByTestId('ai-quota-badge');
    expect(badge.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'error');
  });

  it('shows how many of the daily uploads are used', async () => {
    seedDocuments();
    stubFetch(0, 3);
    renderApp('/workspace');

    expect(await screen.findByTestId('upload-quota')).toHaveTextContent(
      '3 of 5 documents used today',
    );
  });

  it('opens the global quota modal instead of an inline error when an upload is rejected', async () => {
    stubFetch(0, 5);
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: /Paste or write code/ }));
    await user.type(screen.getByTestId('code-input-textarea'), 'print("hello world")');
    await user.click(screen.getByRole('button', { name: 'Analyze' }));

    const modal = await screen.findByRole('alertdialog');
    expect(modal).toHaveTextContent('⏰ Daily quota reached');
    expect(modal).toHaveTextContent('See you in 5 hours. Your data has been saved.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('workspace document delete', () => {
  it('removes a document the backend already deleted instead of showing an error', async () => {
    seedDocuments();
    const fetchMock = stubFetch(0);
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Delete stale.pdf' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete stale.pdf' })).not.toBeInTheDocument();
    });
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          urlOf(input).endsWith('/api/documents/doc-2') && init?.method === 'DELETE',
      ),
    ).toBe(true);
    const recent = readJsonStorage<{ id: string }[]>(STORAGE_KEYS.recentDocuments) ?? [];
    expect(recent.map((entry) => entry.id)).toEqual([FIRST.id]);
  });
});
