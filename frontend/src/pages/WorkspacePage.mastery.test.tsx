import { screen, waitFor } from '@testing-library/react';
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
  prompt_version: '8',
  model: 'mock',
  cached: false,
};

const QUIZ_RESPONSE = {
  quiz_set_id: 'quiz-1',
  questions: [
    {
      id: 1,
      kind: 'multiple_choice',
      topic: 'Searching',
      difficulty: 'medium',
      question: 'Which technique halves the search range each step?',
      options: ['Linear scan', 'Binary search', 'Bubble sort', 'Hashing'],
      source_reference: 'Page 2',
    },
  ],
  weak_topics: [],
  metadata: METADATA,
};

const RETEST_QUIZ_RESPONSE = {
  quiz_set_id: 'quiz-retest-1',
  questions: [
    {
      id: 2,
      kind: 'multiple_choice',
      topic: 'Searching',
      difficulty: 'medium',
      question: 'What must be true of the data for binary search to work?',
      options: ['It is sorted', 'It is a linked list', 'It has duplicates', 'It is unsorted'],
      source_reference: 'Page 2',
    },
  ],
  weak_topics: [],
  metadata: METADATA,
};

const WRONG_ANSWER_RESPONSE = {
  question_id: 1,
  kind: 'multiple_choice',
  topic: 'Searching',
  correct: false,
  score: 0,
  provided: 'Linear scan',
  expected: 'Binary search',
  explanation: 'Binary search halves the range each step.',
  feedback: null,
  missing_key_points: [],
  source_reference: 'Page 2',
};

const CORRECT_RETEST_ANSWER_RESPONSE = {
  question_id: 2,
  kind: 'multiple_choice',
  topic: 'Searching',
  correct: true,
  score: 1,
  provided: 'It is sorted',
  expected: 'It is sorted',
  explanation: 'Binary search relies on sorted data.',
  feedback: null,
  missing_key_points: [],
  source_reference: 'Page 2',
};

const RESULTS_RESPONSE = {
  quiz_set_id: 'quiz-1',
  total_questions: 1,
  answered_questions: 1,
  correct_count: 0,
  score: 0,
  topic_breakdown: [{ topic: 'Searching', correct: 0, total: 1, answered: 1, average_score: 0 }],
  weak_topics: ['Searching'],
};

const WEAK_TOPICS_RESPONSE = [{ topic: 'Searching', mastery: 0, attempts: 1 }];

function masteryOverview(topic: string, mastery: number, attempts: number) {
  const level = mastery < 0.5 ? 'weak' : mastery < 0.75 ? 'developing' : 'strong';
  return [{ topic, mastery, level, attempts, correct: 0 }];
}

const REEXPLAIN_RESPONSE = {
  topic: 'Searching',
  level: 'beginner',
  explanation: 'Binary search repeatedly halves the range of values to check.',
  example: 'Looking for 7 in [1,3,5,7,9]: check the middle (5), then check 7.',
  trace: '',
  references: ['Page 2'],
  mastery: 0,
  metadata: METADATA,
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

interface MasteryFlowOptions {
  /** Server mastery before the retest (what the results screen first loads). */
  before: number;
  /** Server mastery after the retest (every later mastery fetch returns this). */
  after: number;
  /** Topic spelling the server reports after the retest, to exercise normalized matching. */
  afterTopic?: string;
}

function stubMasteryFlowFetch({
  before,
  after,
  afterTopic = 'Searching',
}: MasteryFlowOptions): void {
  const quizQueue = [QUIZ_RESPONSE, RETEST_QUIZ_RESPONSE];
  const answerQueue = [WRONG_ANSWER_RESPONSE, CORRECT_RETEST_ANSWER_RESPONSE];
  const masteryQueue = [masteryOverview('Searching', before, 1)];
  const masteryAfter = masteryOverview(afterTopic, after, 2);

  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

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
          metadata: METADATA,
        }),
      );
    }
    if (/\/documents\/[^/]+\/quiz$/.exec(url) && method === 'POST') {
      return Promise.resolve(Response.json(quizQueue.shift() ?? QUIZ_RESPONSE));
    }
    if (/\/quiz\/\d+\/answer$/.exec(url) && method === 'POST') {
      return Promise.resolve(Response.json(answerQueue.shift() ?? CORRECT_RETEST_ANSWER_RESPONSE));
    }
    if (/\/quiz\/[^/]+\/results$/.exec(url) && method === 'GET') {
      return Promise.resolve(Response.json(RESULTS_RESPONSE));
    }
    if (/\/documents\/[^/]+\/weak-topics$/.exec(url) && method === 'GET') {
      return Promise.resolve(Response.json(WEAK_TOPICS_RESPONSE));
    }
    if (/\/documents\/[^/]+\/mastery$/.exec(url) && method === 'GET') {
      return Promise.resolve(Response.json(masteryQueue.shift() ?? masteryAfter));
    }
    if (/\/topics\/Searching\/reexplain$/.exec(url) && method === 'POST') {
      return Promise.resolve(Response.json(REEXPLAIN_RESPONSE));
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

async function retestWeakTopic(): Promise<void> {
  const user = userEvent.setup();
  renderApp('/workspace');

  await user.click(await screen.findByRole('button', { name: 'Quiz' }));
  await user.click(await screen.findByRole('button', { name: 'Start quiz' }));
  await screen.findByText('Which technique halves the search range each step?');

  await user.click(screen.getByRole('radio', { name: '1 Linear scan' }));
  await user.click(screen.getByRole('button', { name: 'Check answer' }));
  await screen.findByText('Not quite');
  await user.click(screen.getByRole('button', { name: 'See results' }));

  // The weak topic's re-explain card appears automatically.
  await screen.findByText('Topic mastery');
  expect(screen.getByText(/Your mastery of Searching is still developing/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Re-explain this topic' }));
  expect(
    await screen.findByText('Binary search repeatedly halves the range of values to check.'),
  ).toBeInTheDocument();
  expect(screen.getByText(/Looking for 7 in/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Retest this topic' }));
  await screen.findByText('What must be true of the data for binary search to work?');

  await user.click(screen.getByRole('radio', { name: '1 It is sorted' }));
  await user.click(screen.getByRole('button', { name: 'Check answer' }));
  await screen.findByText('Correct');
  await user.click(screen.getByRole('button', { name: 'See results' }));
}

describe('adaptive personalization flow', () => {
  it('re-explains a weak topic, retests it, and shows the server-computed mastery rising', async () => {
    seedDocument();
    stubMasteryFlowFetch({ before: 0.4, after: 0.8 });

    await retestWeakTopic();

    expect(
      await screen.findByText('Nice work! Your mastery for this topic is now 80%.'),
    ).toBeInTheDocument();
    // The card's bar shows the refetched server value, and the page-level mastery panel is
    // refetched too, so no stale pre-retest 40% remains anywhere.
    expect((await screen.findAllByText('80%')).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.queryByText('40%')).not.toBeInTheDocument();
    });
  });

  it('matches the retested topic even when the server spells it differently', async () => {
    seedDocument();
    stubMasteryFlowFetch({ before: 0.4, after: 0.7, afterTopic: '  searching ' });

    await retestWeakTopic();

    expect(
      await screen.findByText('Nice work! Your mastery for this topic is now 70%.'),
    ).toBeInTheDocument();
  });

  it('shows neutral copy, not "Nice work", when mastery is unchanged', async () => {
    seedDocument();
    stubMasteryFlowFetch({ before: 0.4, after: 0.4 });

    await retestWeakTopic();

    expect(await screen.findByText('Retest complete. Current mastery: 40%.')).toBeInTheDocument();
    expect(screen.queryByText(/Nice work/)).not.toBeInTheDocument();
  });

  it('shows encouraging copy, not "Nice work", when mastery dropped', async () => {
    seedDocument();
    stubMasteryFlowFetch({ before: 0.4, after: 0.25 });

    await retestWeakTopic();

    expect(await screen.findByText('Keep practicing. Current mastery: 25%.')).toBeInTheDocument();
    expect(screen.queryByText(/Nice work/)).not.toBeInTheDocument();
  });
});
