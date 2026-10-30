import { screen } from '@testing-library/react';
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
  page_count: 1,
};

const METADATA = {
  document_id: DOCUMENT.id,
  content_type: 'lecture',
  task: 'quiz',
  level: 'intermediate',
  language: 'en',
  chunks_used: 1,
  prompt_version: '6',
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
      source_reference: 'Page 1',
    },
  ],
  weak_topics: ['Searching'],
  metadata: METADATA,
};

const ANSWER_RESPONSE = {
  question_id: 1,
  kind: 'multiple_choice',
  topic: 'Sorting',
  correct: true,
  score: 1,
  provided: 'Sort',
  expected: 'Sort',
  explanation: 'Sorting organizes values in order.',
  feedback: null,
  missing_key_points: [],
  source_reference: 'Page 1',
};

const RESULTS_RESPONSE = {
  quiz_set_id: 'quiz-1',
  total_questions: 1,
  answered_questions: 1,
  correct_count: 1,
  score: 1,
  topic_breakdown: [{ topic: 'Sorting', correct: 1, total: 1, answered: 1, average_score: 1 }],
  weak_topics: [],
};

const WEAK_TOPICS_RESPONSE = [{ topic: 'Searching', mastery: 0.2, attempts: 3 }];

const MASTERY_RESPONSE = [
  { topic: 'Sorting', mastery: 1, level: 'strong', attempts: 1, correct: 1 },
  { topic: 'Searching', mastery: 0.2, level: 'weak', attempts: 3, correct: 0 },
];

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
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubQuizFetch(): ReturnType<typeof vi.fn<FetchMock>> {
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/health')) {
      return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
    }
    if (url.includes('/summary')) {
      return Promise.resolve(
        sseJsonResponse({
          overview: 'Overview',
          key_concepts: [],
          takeaways: [],
          confidence_notes: [],
          metadata: METADATA,
        }),
      );
    }
    if (url.includes('/explanation')) {
      return Promise.resolve(
        sseJsonResponse({
          sections: [],
          recommendations: [],
          walkthrough: [],
          confidence_notes: [],
          metadata: METADATA,
        }),
      );
    }
    if (/\/documents\/[^/]+\/quiz$/.exec(url) && method === 'POST') {
      return Promise.resolve(Response.json(QUIZ_RESPONSE));
    }
    if (/\/quiz\/\d+\/answer$/.exec(url) && method === 'POST') {
      return Promise.resolve(Response.json(ANSWER_RESPONSE));
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

describe('quiz start screen', () => {
  it('sends the selected question count and type mix when starting a quiz', async () => {
    seedDocument();
    const fetchMock = stubQuizFetch();
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Quiz' }));
    await user.click(screen.getByRole('checkbox', { name: 'Short answer' }));
    await user.click(screen.getByRole('button', { name: '4' }));
    await user.click(screen.getByRole('button', { name: 'Start quiz' }));

    await screen.findByText('Which operation arranges values in order?');

    const quizCall = fetchMock.mock.calls.find(([input]) =>
      /\/documents\/doc-1\/quiz$/.exec(requestUrl(input)),
    );
    expect(quizCall).toBeDefined();
    const body = readBody(quizCall?.[1]);
    expect(body).toMatchObject({ num_questions: 4, question_types: ['multiple_choice'] });
  });

  it('sends both types by default', async () => {
    seedDocument();
    const fetchMock = stubQuizFetch();
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Quiz' }));
    await user.click(screen.getByRole('button', { name: 'Start quiz' }));
    await screen.findByText('Which operation arranges values in order?');

    const quizCall = fetchMock.mock.calls.find(([input]) =>
      /\/documents\/doc-1\/quiz$/.exec(requestUrl(input)),
    );
    expect(readBody(quizCall?.[1])).toMatchObject({
      question_types: ['multiple_choice', 'short_answer'],
    });
  });

  it('keeps at least one question type selected', async () => {
    seedDocument();
    stubQuizFetch();
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Quiz' }));
    const multipleChoice = screen.getByRole('checkbox', { name: 'Multiple choice' });
    const shortAnswer = screen.getByRole('checkbox', { name: 'Short answer' });
    expect(multipleChoice).toBeEnabled();
    expect(screen.getByText('Keep at least one question type selected.')).toBeInTheDocument();

    await user.click(shortAnswer);

    expect(shortAnswer).not.toBeChecked();
    expect(multipleChoice).toBeChecked();
    expect(multipleChoice).toBeDisabled();

    await user.click(shortAnswer);

    expect(multipleChoice).toBeEnabled();
  });
});

describe('quiz flow', () => {
  it('answers a question by keyboard shortcut and reaches results with weak topics', async () => {
    seedDocument();
    const fetchMock = stubQuizFetch();
    // jsdom has no scrollIntoView implementation; the source-reference chip uses it.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Quiz' }));
    await user.click(await screen.findByRole('button', { name: 'Start quiz' }));
    await screen.findByText('Which operation arranges values in order?');

    // "2" is the keyboard shortcut for the second option ("Sort").
    await user.keyboard('2');
    await user.click(screen.getByRole('button', { name: 'Check answer' }));

    expect(await screen.findByText('Correct')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Source reference: Page 1/ }));
    expect(scrollIntoView).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'See results' }));

    expect(await screen.findByText('Quiz results')).toBeInTheDocument();
    // A perfect score (Phase 6): the donut/band block shows "Excellent work!", not a bare "1/1".
    expect(screen.getByRole('heading', { level: 3, name: 'Excellent work!' })).toBeInTheDocument();
    expect(screen.getAllByText(/1\/1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Searching').length).toBeGreaterThan(0);

    expect(screen.getByRole('button', { name: 'Retry wrong questions' })).toBeDisabled();
    // The only weak topic ("Searching") is already auto-revealed as a re-explain card, so
    // there is nothing left for the button to reveal.
    expect(screen.getByRole('button', { name: 'Explain my weak topics' })).toBeDisabled();
    expect(
      await screen.findByText(/Your mastery of Searching is still developing/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New quiz' }));
    await screen.findByText('Which operation arranges values in order?');

    // "New quiz" bumps the variation seed and forces a fresh generation.
    const quizBodies = fetchMock.mock.calls
      .filter(([input]) => /\/documents\/doc-1\/quiz$/.exec(requestUrl(input)))
      .map(([, init]) => readBody(init));
    expect(quizBodies).toHaveLength(2);
    expect(quizBodies[0]).toMatchObject({ regenerate: false, variation_seed: 0 });
    expect(quizBodies[1]).toMatchObject({ regenerate: true, variation_seed: 1 });
  });
});
