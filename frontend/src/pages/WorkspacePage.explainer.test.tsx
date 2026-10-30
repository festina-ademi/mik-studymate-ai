import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp, sseJsonResponse } from '../test/utils';
import { STORAGE_KEYS, writeJsonStorage, writeStorage } from '../lib/storage';
import type { DocumentRecord } from '../lib/api';

const DOCUMENT: DocumentRecord = {
  id: 'doc-1',
  filename: 'lecture.pdf',
  content_hash: 'hash-1',
  content_type: 'lecture',
  source_format: 'pdf',
  detected_language: 'en',
  size_bytes: 100,
  page_count: 2,
};

const METADATA = {
  document_id: DOCUMENT.id,
  level: 'intermediate',
  language: 'en',
  simplified: false,
  prompt_version: '9',
  model: 'mock',
  cached: false,
};

const PLAN_RESPONSE = {
  document_id: DOCUMENT.id,
  sections: [
    {
      index: 0,
      title: 'Getting started',
      source_reference: 'Page 1',
      page_start: 1,
      page_end: 1,
      line_start: null,
      line_end: null,
    },
    {
      index: 1,
      title: 'Wrapping up',
      source_reference: 'Page 2',
      page_start: 2,
      page_end: 2,
      line_start: null,
      line_end: null,
    },
  ],
  overview: {
    section_index: -1,
    title: 'Overview',
    text: 'Welcome to this document. It covers one short idea.',
    captions: ['Welcome to this document.', 'It covers one short idea.'],
    source_reference: null,
    page_start: null,
    page_end: null,
    line_start: null,
    line_end: null,
    quiz: null,
    metadata: METADATA,
  },
};

function seedDocument(): void {
  writeJsonStorage(STORAGE_KEYS.recentDocuments, [
    {
      id: DOCUMENT.id,
      filename: DOCUMENT.filename,
      content_type: DOCUMENT.content_type,
      source_format: DOCUMENT.source_format,
      detected_language: DOCUMENT.detected_language,
      updatedAt: new Date().toISOString(),
    },
  ]);
  writeStorage(STORAGE_KEYS.currentDocumentId, DOCUMENT.id);
  writeJsonStorage(STORAGE_KEYS.documentState, { document: DOCUMENT });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubExplainerFlowFetch(): void {
  const fetchMock = vi.fn<FetchMock>((input) => {
    const url = requestUrl(input);
    if (url.endsWith('/api/health')) {
      return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
    }
    if (url.includes('/summary') || url.includes('/explanation')) {
      return Promise.resolve(
        sseJsonResponse({
          overview: 'Overview',
          sections: [],
          key_concepts: [],
          takeaways: [],
          recommendations: [],
          walkthrough: [],
          confidence_notes: [],
          metadata: { ...METADATA, content_type: 'lecture', task: 'summary', chunks_used: 1 },
        }),
      );
    }
    if (url.includes('/explainer/plan')) {
      return Promise.resolve(Response.json(PLAN_RESPONSE));
    }
    if (url.includes('/explainer/sections/0')) {
      return Promise.resolve(
        Response.json({
          section_index: 0,
          title: 'Getting started',
          text: 'This section gets you started.',
          captions: ['This section gets you started.'],
          source_reference: 'Page 1',
          page_start: 1,
          page_end: 1,
          line_start: null,
          line_end: null,
          quiz: null,
          metadata: { ...METADATA, content_type: 'lecture' },
        }),
      );
    }
    return Promise.resolve(
      Response.json(
        { error: { code: 'not_found', message_key: 'errors.not_found', details: {} } },
        { status: 404 },
      ),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('explainer tab', () => {
  it('plans the document and shows the overview script when the tab is opened', async () => {
    seedDocument();
    stubExplainerFlowFetch();
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Avatar' }));

    // The play control only appears once the ExplainerPanel chunk has loaded (it is a lazily
    // loaded component, see WorkspacePage.tsx) and the plan + overview script have loaded, so
    // its presence confirms the whole plan/overview round-trip rendered through real components.
    expect(
      await screen.findByRole('button', { name: 'Play' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
    expect(screen.getByText('Following along')).toBeInTheDocument();
  });

  it('shows real section titles as pills instead of bare numbers, and jumps on click', async () => {
    seedDocument();
    stubExplainerFlowFetch();
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Avatar' }));
    await screen.findByRole('button', { name: 'Play' }, { timeout: 3000 });

    const sectionList = screen.getByLabelText('Sections');
    expect(within(sectionList).getByText('Getting started')).toBeInTheDocument();
    expect(within(sectionList).getByText('Wrapping up')).toBeInTheDocument();
    // Numbered, not just a bare circle: each pill pairs the number with the real title.
    expect(within(sectionList).getByText('1')).toBeInTheDocument();
    expect(within(sectionList).getByText('2')).toBeInTheDocument();

    await user.click(within(sectionList).getByRole('button', { name: /Getting started/ }));

    expect(await screen.findByText('Section 1 of 2')).toBeInTheDocument();
  });
});
