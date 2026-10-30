import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../test/utils';
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
  page_count: 1,
};

const METADATA = {
  document_id: DOCUMENT.id,
  content_type: 'lecture',
  task: 'quiz',
  level: 'intermediate',
  language: 'en',
  chunks_used: 1,
  prompt_version: '15',
  model: 'mock',
  cached: false,
};

const QUIZ_RESPONSE = {
  quiz_set_id: 'quiz-1',
  questions: [
    {
      id: 1,
      kind: 'multiple_choice',
      topic: 'Sorting',
      difficulty: 'easy',
      question: 'Which operation arranges values in order?',
      options: ['Search', 'Sort', 'Copy', 'Delete'],
      allow_multiple: false,
      source_reference: 'Page 1',
    },
    {
      id: 2,
      kind: 'multiple_choice',
      topic: 'Sorting',
      difficulty: 'easy',
      question: 'Which of these is a sorting algorithm?',
      options: ['Linear scan', 'Binary search', 'Quicksort', 'Hash map'],
      allow_multiple: false,
      source_reference: 'Page 1',
    },
  ],
  weak_topics: [],
  metadata: METADATA,
};

const SINGLE_ANSWER_RESPONSE = {
  question_id: 1,
  kind: 'multiple_choice',
  topic: 'Sorting',
  correct: true,
  score: 1,
  provided: 'Sort',
  expected: 'Sort',
  correct_option_indices: [1],
  explanation: 'Sorting organizes values in order.',
  feedback: null,
  missing_key_points: [],
  source_reference: 'Page 1',
  peeked: false,
};

const RESULTS_RESPONSE = {
  quiz_set_id: 'quiz-1',
  total_questions: 2,
  answered_questions: 2,
  correct_count: 2,
  score: 1,
  topic_breakdown: [{ topic: 'Sorting', correct: 2, total: 2, answered: 2, average_score: 1 }],
  weak_topics: [],
  peeked: false,
};

const WEAK_TOPICS_RESPONSE: unknown[] = [];
const MASTERY_RESPONSE: unknown[] = [];

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
  writeJsonStorage(STORAGE_KEYS.chunksState, [
    { text: 'Sorting puts values in order.', heading: 'Page 1', page_start: 1, page_end: 1 },
  ]);
}

function readBody(init: RequestInit | undefined): Record<string, unknown> {
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubExamModeFetch(
  secondAnswer: Record<string, unknown>,
): ReturnType<typeof vi.fn<FetchMock>> {
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/health')) {
      return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
    }
    if (/\/documents\/[^/]+\/quiz$/.exec(url) && method === 'POST') {
      return Promise.resolve(Response.json(QUIZ_RESPONSE));
    }
    if (/\/quiz\/1\/answer$/.exec(url) && method === 'POST') {
      return Promise.resolve(Response.json(SINGLE_ANSWER_RESPONSE));
    }
    if (/\/quiz\/2\/answer$/.exec(url) && method === 'POST') {
      return Promise.resolve(Response.json(secondAnswer));
    }
    if (/\/quiz\/[^/]+\/results$/.exec(url) && method === 'GET') {
      return Promise.resolve(Response.json(RESULTS_RESPONSE));
    }
    if (/\/documents\/[^/]+\/weak-topics$/.exec(url) && method === 'GET') {
      return Promise.resolve(Response.json(WEAK_TOPICS_RESPONSE));
    }
    if (/\/documents\/[^/]+\/mastery$/.exec(url) && method === 'GET') {
      return Promise.resolve(Response.json(MASTERY_RESPONSE));
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

describe('quiz exam mode', () => {
  it('hides the source panel once the quiz starts, with every MC question rendered as radios', async () => {
    seedDocument();
    stubExamModeFetch({ ...SINGLE_ANSWER_RESPONSE, question_id: 2 });
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Quiz' }));
    expect(screen.getByText('Original material')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Start quiz' }));
    await screen.findByText('Which operation arranges values in order?');

    // Exam mode: the source panel is gone, replaced by the collapsed rail; the banner shows.
    expect(screen.queryByText('Original material')).not.toBeInTheDocument();
    expect(screen.getByText('Exam mode — source material hidden')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '2 Sort' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Sort/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '2 Sort' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    await screen.findByText('Correct');
    await user.click(screen.getByRole('button', { name: 'Next question' }));

    await screen.findByText('Which of these is a sorting algorithm?');
    // No multi-correct hint, and still radios, not checkboxes.
    expect(screen.queryByText(/more than one correct answer/i)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '3 Quicksort' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('reveals the source via "View source" and flags the rest of the quiz as peeked', async () => {
    seedDocument();
    const fetchMock = stubExamModeFetch({
      ...SINGLE_ANSWER_RESPONSE,
      question_id: 2,
      peeked: true,
    });
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Quiz' }));
    await user.click(await screen.findByRole('button', { name: 'Start quiz' }));
    await screen.findByText('Which operation arranges values in order?');

    expect(screen.queryByText('Original material')).not.toBeInTheDocument();
    // Both the banner's own button and the collapsed rail's (CSS-only hidden below `xl`, so
    // still present in the DOM) share this name; the banner's is the one meant to be clicked.
    const [bannerViewSource] = screen.getAllByRole('button', { name: 'View source' });
    if (!bannerViewSource) {
      throw new Error('expected a "View source" button to be rendered');
    }
    await user.click(bannerViewSource);
    expect(await screen.findByText('Original material')).toBeInTheDocument();
    // The banner's own "View source" button disappears once already revealed.
    expect(screen.queryByRole('button', { name: 'View source' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '2 Sort' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    await screen.findByText('Correct');

    const firstAnswerCall = fetchMock.mock.calls.find(([input]) =>
      /\/quiz\/1\/answer$/.exec(requestUrl(input)),
    );
    expect(readBody(firstAnswerCall?.[1])).toMatchObject({ peeked: true });

    await user.click(screen.getByRole('button', { name: 'Next question' }));
    await screen.findByText('Which of these is a sorting algorithm?');
    await user.click(screen.getByRole('radio', { name: '3 Quicksort' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    await screen.findByText('Correct');

    const secondAnswerCall = fetchMock.mock.calls.find(([input]) =>
      /\/quiz\/2\/answer$/.exec(requestUrl(input)),
    );
    expect(readBody(secondAnswerCall?.[1])).toMatchObject({
      selected_option_indices: [2],
      peeked: true,
    });

    await user.click(screen.getByRole('button', { name: 'See results' }));
    // Finishing the quiz re-shows the source panel automatically.
    expect(await screen.findByText('Original material')).toBeInTheDocument();
  });

  it('re-shows the source panel automatically once the quiz finishes, even without peeking', async () => {
    seedDocument();
    stubExamModeFetch({ ...SINGLE_ANSWER_RESPONSE, question_id: 2 });
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Quiz' }));
    await user.click(await screen.findByRole('button', { name: 'Start quiz' }));
    await screen.findByText('Which operation arranges values in order?');
    expect(screen.queryByText('Original material')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '2 Sort' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    await screen.findByText('Correct');
    await user.click(screen.getByRole('button', { name: 'Next question' }));

    await screen.findByText('Which of these is a sorting algorithm?');
    await user.click(screen.getByRole('radio', { name: '2 Binary search' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    await screen.findByText(/Not quite|Correct/);
    await user.click(screen.getByRole('button', { name: 'See results' }));

    expect(await screen.findByText('Original material')).toBeInTheDocument();
  });
});
