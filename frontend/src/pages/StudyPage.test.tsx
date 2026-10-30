import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../test/utils';

const PARTICIPANT = {
  code: 'P-7K2M',
  group: 'control',
  language: 'en',
  document_id: 'doc-1',
  material_name: 'Week 1',
  withdrawn: false,
  immediate_submitted: false,
  questionnaire_submitted: false,
  retention_submitted: false,
  retention_unlock_at: null,
};

const TEST_PUBLIC = {
  test_id: 'test-1',
  items: [
    {
      id: 1,
      kind: 'multiple_choice',
      topic: 'Sorting',
      question: 'Which operation orders values?',
      options: ['Sort', 'Copy', 'Delete', 'Move'],
      max_score: 1,
    },
  ],
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubStudyFlowFetch(): void {
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/health')) {
      return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
    }
    if (url.endsWith('/api/study/participants') && method === 'POST') {
      return Promise.resolve(Response.json(PARTICIPANT));
    }
    if (/\/study\/participants\/[^/]+\/timer\/start$/.exec(url)) {
      return Promise.resolve(
        Response.json({
          started: true,
          duration_seconds: 1200,
          remaining_seconds: 1200,
          expired: false,
        }),
      );
    }
    if (/\/study\/participants\/[^/]+\/timer$/.exec(url) && method === 'GET') {
      // Already expired, so the test moves straight to the immediate test.
      return Promise.resolve(
        Response.json({
          started: true,
          duration_seconds: 1200,
          remaining_seconds: 0,
          expired: true,
        }),
      );
    }
    if (/\/study\/participants\/[^/]+\/test$/.exec(url) && method === 'GET') {
      return Promise.resolve(Response.json(TEST_PUBLIC));
    }
    if (/\/study\/participants\/[^/]+\/test\/immediate$/.exec(url) && method === 'POST') {
      return Promise.resolve(
        Response.json({ phase: 'immediate', total_score: 1, max_possible_score: 1 }),
      );
    }
    if (/\/documents\/doc-1$/.exec(url)) {
      return Promise.resolve(
        Response.json({
          id: 'doc-1',
          filename: 'lecture.pdf',
          content_hash: 'hash-1',
          content_type: 'lecture',
          source_format: 'pdf',
          detected_language: 'en',
          size_bytes: 100,
          page_count: 1,
        }),
      );
    }
    if (/\/documents\/doc-1\/chunks$/.exec(url)) {
      return Promise.resolve(
        Response.json([
          {
            text: 'Sorting puts values in order.',
            heading: 'Page 1',
            page_start: 1,
            page_end: 1,
            line_start: null,
            line_end: null,
          },
        ]),
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

describe('study participant flow', () => {
  it('walks a control-group participant from language choice to the thank-you screen', async () => {
    stubStudyFlowFetch();
    const user = userEvent.setup();
    renderApp('/study/participate');

    // Language choice. StudyPage is a lazily-loaded route chunk (see App.tsx); a generous
    // timeout keeps this first assertion reliable when the suite runs many files in parallel.
    await user.click(await screen.findByRole('button', { name: 'English' }, { timeout: 10_000 }));

    // Consent.
    await screen.findByText('Informed consent');
    await user.click(screen.getByRole('button', { name: 'I understand and agree to take part' }));

    // Participant code screen.
    expect(await screen.findByText('P-7K2M')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "I've saved my code — continue" }));

    // Session: the timer bar's first poll already reports expired, so the test page appears.
    expect(
      await screen.findByText('Which operation orders values?', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1 Sort' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // Control group has no questionnaire: straight to the thank-you screen.
    expect(await screen.findByText('Thank you for taking part!')).toBeInTheDocument();
    expect(screen.getByText('P-7K2M')).toBeInTheDocument();
  });
});
