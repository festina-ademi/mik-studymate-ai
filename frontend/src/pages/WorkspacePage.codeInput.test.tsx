import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp, sseJsonResponse } from '../test/utils';
import { STORAGE_KEYS, writeJsonStorage, writeStorage } from '../lib/storage';
import type { ChunkRecord, DocumentRecord } from '../lib/api';

const DOCUMENT: DocumentRecord = {
  id: 'doc-1',
  filename: 'pasted_code_2026-10-12.py',
  content_hash: 'hash-1',
  content_type: 'code',
  source_format: 'code',
  detected_language: 'en',
  size_bytes: 40,
  page_count: null,
};

const CHUNKS: ChunkRecord[] = [
  {
    text: 'def add(a, b):\n    return a + b',
    heading: 'add',
    page_start: null,
    page_end: null,
    line_start: null,
    line_end: null,
  },
];

const METADATA = {
  document_id: DOCUMENT.id,
  content_type: 'code',
  level: 'intermediate',
  language: 'en',
  chunks_used: 1,
  prompt_version: '18',
  model: 'mock',
  cached: false,
};

const SUMMARY_BODY = {
  overview: 'This function adds two numbers together [add].',
  key_concepts: [],
  takeaways: [],
  confidence_notes: [],
  metadata: { ...METADATA, task: 'summary' },
};

const EXPLANATION_BODY = {
  sections: [
    { title: 'What it does', content: 'Adds a and b and returns the sum.', references: ['add'] },
  ],
  recommendations: [],
  walkthrough: [],
  confidence_notes: [],
  metadata: { ...METADATA, task: 'explanation' },
};

const QUIZ_RESPONSE = {
  quiz_set_id: 'quiz-1',
  questions: [
    {
      id: 1,
      kind: 'multiple_choice',
      topic: 'Functions',
      difficulty: 'easy',
      question: 'What does this function return?',
      options: ['The sum of a and b', 'The product of a and b', 'Nothing', 'An error'],
      source_reference: 'add',
    },
  ],
  weak_topics: [],
  metadata: { ...METADATA, task: 'quiz' },
};

const PLAN_RESPONSE = {
  document_id: DOCUMENT.id,
  sections: [
    {
      index: 0,
      title: 'add',
      source_reference: 'add',
      page_start: null,
      page_end: null,
      line_start: 1,
      line_end: 2,
    },
  ],
  overview: {
    section_index: -1,
    title: 'Overview',
    text: 'This short snippet defines one function.',
    captions: ['This short snippet defines one function.'],
    source_reference: null,
    page_start: null,
    page_end: null,
    line_start: null,
    line_end: null,
    quiz: null,
    metadata: { ...METADATA, task: 'explainer', simplified: false },
  },
};

function seedCodeDocument(): void {
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
  writeJsonStorage(STORAGE_KEYS.chunksState, CHUNKS);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubWorkspaceFetch(): ReturnType<typeof vi.fn<FetchMock>> {
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/health')) {
      return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
    }
    if (url.includes('/summary')) {
      return Promise.resolve(sseJsonResponse(SUMMARY_BODY));
    }
    if (url.includes('/explanation')) {
      return Promise.resolve(sseJsonResponse(EXPLANATION_BODY));
    }
    if (/\/documents\/[^/]+\/quiz$/.exec(url) && method === 'POST') {
      return Promise.resolve(Response.json(QUIZ_RESPONSE));
    }
    if (url.endsWith('/tutor/history') && method === 'GET') {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/tutor') && method === 'POST') {
      const body = `event: result\ndata: ${JSON.stringify({
        answer: 'It adds the two arguments and returns the result [add].',
        citations: [{ reference: 'add', snippet: 'add' }],
        follow_up_questions: [],
        conversation_id: 'conv-1',
        metadata: { ...METADATA, task: 'tutor' },
      })}\n\nevent: done\ndata: {}\n\n`;
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      );
    }
    if (url.includes('/explainer/plan')) {
      return Promise.resolve(Response.json(PLAN_RESPONSE));
    }
    if (url.includes('/documents/') && url.endsWith('/code') && method === 'POST') {
      return Promise.resolve(
        Response.json(
          {
            document: DOCUMENT,
            chunks: CHUNKS,
            detected_programming_language: 'python',
            language_detected_automatically: true,
          },
          { status: 201 },
        ),
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
  return fetchMock;
}

describe('code document creation flow', () => {
  it('lets a student paste code, analyzes it, and opens the workspace on the result', async () => {
    window.localStorage.clear();
    stubWorkspaceFetch();
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: /Paste or write code/ }));
    await user.type(screen.getByTestId('code-input-textarea'), 'def add(a, b):\n    return a + b');
    await user.click(screen.getByRole('button', { name: 'Analyze' }));

    expect(await screen.findByRole('heading', { name: DOCUMENT.filename })).toBeInTheDocument();
    expect(
      await screen.findByText(
        'This function adds two numbers together [add].',
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('code').length).toBeGreaterThan(0);
  });
});

describe('workspace tabs for a code document', () => {
  it('renders Summary, Explanation, Quiz, Chat and Avatar for pasted/typed source code', async () => {
    seedCodeDocument();
    stubWorkspaceFetch();
    const user = userEvent.setup();
    renderApp('/workspace');

    expect(
      await screen.findByText('This function adds two numbers together [add].'),
    ).toBeInTheDocument();
    // The code preview panel renders the source in monospace with a muted, non-selectable
    // line-number gutter (Phase 12) -- each line is its own element, numbered from 1 since this
    // fixture's chunk has no real `line_start`.
    expect(screen.getByText('def add(a, b):').closest('.font-mono')).not.toBeNull();
    expect(screen.getByText('return a + b')).toBeInTheDocument();
    const gutterOne = screen.getByText('1');
    expect(gutterOne).toHaveClass('select-none');
    expect(gutterOne).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('2')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Explanation' }));
    expect(await screen.findByText('Adds a and b and returns the sum.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Quiz' }));
    await user.click(await screen.findByRole('button', { name: 'Start quiz' }));
    expect(await screen.findByText('What does this function return?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Chat' }));
    const exampleQuestion = await screen.findByRole('button', {
      name: 'What does the main function in this code do?',
    });
    await user.click(exampleQuestion);
    expect(
      await screen.findByText('It adds the two arguments and returns the result [add].'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Avatar' }));
    // The play control only appears once the plan + overview script round-trip has resolved
    // through the real (lazily loaded) ExplainerPanel component.
    expect(
      await screen.findByRole('button', { name: 'Play' }, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("numbers the gutter from the chunk's real line_start, not always from 1", async () => {
    const document: DocumentRecord = { ...DOCUMENT, id: 'doc-2' };
    const chunks: ChunkRecord[] = [
      {
        text: 'def add(a, b):\n    return a + b',
        heading: 'add',
        page_start: null,
        page_end: null,
        line_start: 5,
        line_end: 6,
      },
    ];
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
    writeJsonStorage(STORAGE_KEYS.chunksState, chunks);
    stubWorkspaceFetch();
    renderApp('/workspace');

    expect(await screen.findByText('def add(a, b):')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });
});
