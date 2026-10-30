import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DocumentRecord } from '../lib/api';
import { STORAGE_KEYS, writeJsonStorage, writeStorage } from '../lib/storage';
import { renderApp, sseJsonResponse } from '../test/utils';

const METADATA = {
  content_type: 'lecture',
  task: 'summary',
  level: 'intermediate',
  language: 'en',
  chunks_used: 3,
  prompt_version: '12',
  model: 'mock',
  cached: false,
};

const SUMMARY_BODY = {
  overview:
    'This lecture covers medieval fortresses in Albania, including their history and design [Page 1].',
  key_concepts: [
    { term: 'Kruja Castle', definition: 'A hilltop stronghold.', references: ['Page 1'] },
  ],
  takeaways: [],
  confidence_notes: [],
  metadata: METADATA,
};

const EXPLANATION_BODY = {
  sections: [],
  recommendations: [],
  walkthrough: [],
  confidence_notes: [],
  metadata: { ...METADATA, task: 'explanation' },
};

function seedDocument(overrides: Partial<DocumentRecord>): DocumentRecord {
  const document: DocumentRecord = {
    id: 'doc-1',
    filename: 'lecture.pdf',
    content_hash: 'hash-1',
    content_type: 'lecture',
    source_format: 'pdf',
    detected_language: 'en',
    size_bytes: 100,
    page_count: 24,
    ...overrides,
  };
  writeJsonStorage(STORAGE_KEYS.recentDocuments, [
    {
      id: document.id,
      filename: document.filename,
      content_type: document.content_type,
      source_format: document.source_format,
      detected_language: document.detected_language,
      updatedAt: new Date().toISOString(),
    },
  ]);
  writeStorage(STORAGE_KEYS.currentDocumentId, document.id);
  writeJsonStorage(STORAGE_KEYS.documentState, { document });
  return document;
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(): ReturnType<typeof vi.fn<FetchMock>> {
  const fetchMock = vi.fn<FetchMock>((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/api/health')) {
      return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
    }
    if (url.includes('/summary')) {
      return Promise.resolve(sseJsonResponse(SUMMARY_BODY));
    }
    if (url.includes('/explanation')) {
      return Promise.resolve(sseJsonResponse(EXPLANATION_BODY));
    }
    return Promise.resolve(Response.json({}, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function summaryRequestLanguages(fetchMock: ReturnType<typeof vi.fn<FetchMock>>): string[] {
  return fetchMock.mock.calls
    .filter(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.includes('/summary');
    })
    .map(([, init]) => {
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as { language?: string }) : {};
      return body.language ?? '';
    });
}

describe('summary tab metadata line', () => {
  it('shows the slide count for a PPTX document, and the topic tags still render', async () => {
    stubFetch();
    seedDocument({ source_format: 'pptx', page_count: 12 });
    renderApp('/workspace');

    expect(await screen.findByText('12 slides · Lecture')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kruja Castle' })).toBeInTheDocument();
  });

  it('shows the page count for a PDF document, singular when there is exactly one', async () => {
    stubFetch();
    seedDocument({ source_format: 'pdf', page_count: 1 });
    renderApp('/workspace');

    expect(await screen.findByText('1 page · Lecture')).toBeInTheDocument();
  });

  it('renders the metadata line in Albanian when the interface language is Albanian', async () => {
    stubFetch();
    seedDocument({ source_format: 'pptx', page_count: 12 });
    const user = userEvent.setup();
    renderApp('/workspace');
    await screen.findByText('12 slides · Lecture');

    await user.click(screen.getByRole('button', { name: 'Shqip (SQ)' }));

    expect(await screen.findByText('12 slajde · Ligjëratë')).toBeInTheDocument();
  });

  it('regenerates the summary in the new language on a language switch, briefly showing a switching indicator', async () => {
    // The Albanian summary request is held open deliberately, so there is a real window in
    // which to observe the "switching" indicator before it resolves -- an instant mock response
    // would make that state too brief for `findByText` to reliably catch.
    let resolveSqSummary: (() => void) | undefined;
    const fetchMock = vi.fn<FetchMock>((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/health')) {
        return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
      }
      if (url.includes('/summary')) {
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as { language?: string }) : {};
        if (body.language === 'sq') {
          return new Promise<Response>((resolve) => {
            resolveSqSummary = () => {
              resolve(sseJsonResponse(SUMMARY_BODY));
            };
          });
        }
        return Promise.resolve(sseJsonResponse(SUMMARY_BODY));
      }
      if (url.includes('/explanation')) {
        return Promise.resolve(sseJsonResponse(EXPLANATION_BODY));
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    seedDocument({ source_format: 'pdf', page_count: 12 });
    const user = userEvent.setup();
    renderApp('/workspace');

    await screen.findByText('Kruja Castle');
    expect(summaryRequestLanguages(fetchMock)).toEqual(['en']);

    await user.click(screen.getByRole('button', { name: 'Shqip (SQ)' }));

    expect(await screen.findByText('Përmbajtja po përshtatet në shqip...')).toBeInTheDocument();
    expect(summaryRequestLanguages(fetchMock)).toEqual(['en', 'sq']);
    // The stale English summary is still showing underneath -- this is not blocking the UI.
    expect(screen.getByText('Kruja Castle')).toBeInTheDocument();

    resolveSqSummary?.();
    await waitFor(() => {
      expect(screen.queryByText('Përmbajtja po përshtatet në shqip...')).not.toBeInTheDocument();
    });
  });

  it('omits the metadata line for a code document', async () => {
    stubFetch();
    seedDocument({ content_type: 'code', source_format: 'py', page_count: null });
    renderApp('/workspace');

    await screen.findByRole('button', { name: 'Kruja Castle' });
    expect(screen.queryByText(/· Lecture/)).not.toBeInTheDocument();
  });
});
