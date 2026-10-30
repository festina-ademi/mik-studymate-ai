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
  task: 'tutor',
  level: 'intermediate',
  language: 'en',
  chunks_used: 1,
  prompt_version: '7',
  model: 'mock',
  cached: false,
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

function formatSseBlock(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Build a fake `text/event-stream` Response, split mid-stream to exercise buffering. */
function sseResponse(events: { event: string; data: unknown }[]): Response {
  const text = events.map((entry) => formatSseBlock(entry.event, entry.data)).join('');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const mid = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function tutorTurnResponse(options: {
  answer: string;
  reference: string;
  followUps: string[];
  conversationId?: string;
}): Response {
  const tokens = options.answer.match(/.{1,6}/g) ?? [options.answer];
  return sseResponse([
    ...tokens.map((text) => ({ event: 'token', data: { text } })),
    {
      event: 'result',
      data: {
        answer: options.answer,
        citations: [{ reference: options.reference, snippet: options.reference }],
        follow_up_questions: options.followUps,
        conversation_id: options.conversationId ?? 'conv-1',
        metadata: METADATA,
      },
    },
    { event: 'done', data: {} },
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

interface TutorFetchStub {
  fetchMock: ReturnType<typeof vi.fn<FetchMock>>;
  queueTurnResponse: (response: Response) => void;
}

function stubTutorFetch(): TutorFetchStub {
  const turnQueue: Response[] = [];
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
    if (url.endsWith('/tutor/history') && method === 'GET') {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/tutor/history') && method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith('/tutor') && method === 'POST') {
      const next = turnQueue.shift();
      if (!next) throw new Error('no scripted tutor turn response queued');
      return Promise.resolve(next);
    }
    return Promise.resolve(
      Response.json(
        { error: { code: 'not_found', message_key: 'errors.not_found', details: {} } },
        { status: 404 },
      ),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    queueTurnResponse: (response: Response) => {
      turnQueue.push(response);
    },
  };
}

describe('tutor chat flow', () => {
  it('streams an answer, shows citations and follow-ups, and supports quick actions and clearing', async () => {
    seedDocument();
    const { fetchMock, queueTurnResponse } = stubTutorFetch();
    // jsdom has no scrollIntoView implementation; citation chips and the chat use it.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Chat' }));

    // Empty state shows example questions in the current language.
    const exampleQuestion = await screen.findByRole('button', {
      name: 'What is the main idea of this material?',
    });

    queueTurnResponse(
      tutorTurnResponse({
        answer: 'Binary search halves the range each time [Page 1].',
        reference: 'Page 1',
        followUps: ['Why does halving matter?'],
      }),
    );
    await user.click(exampleQuestion);

    expect(
      await screen.findByText('Binary search halves the range each time [Page 1].'),
    ).toBeInTheDocument();
    expect(screen.getByText('What is the main idea of this material?')).toBeInTheDocument();

    const citationChip = screen.getByRole('button', { name: 'Page 1' });
    await user.click(citationChip);
    expect(scrollIntoView).toHaveBeenCalled();

    // The follow-up question is offered as a clickable chip.
    const followUpChip = await screen.findByRole('button', { name: 'Why does halving matter?' });
    queueTurnResponse(
      tutorTurnResponse({
        answer: 'Halving keeps the search at O(log n) [Page 1].',
        reference: 'Page 1',
        followUps: [],
      }),
    );
    await user.click(followUpChip);
    expect(
      await screen.findByText('Halving keeps the search at O(log n) [Page 1].'),
    ).toBeInTheDocument();

    // A quick-action chip sends its canned message as the next user turn.
    queueTurnResponse(
      tutorTurnResponse({
        answer: 'Sure — simply put: [Page 1].',
        reference: 'Page 1',
        followUps: [],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Explain simpler' }));
    expect(await screen.findByText('Sure — simply put: [Page 1].')).toBeInTheDocument();

    const quickActionCall = fetchMock.mock.calls.find(
      ([input, init]: [RequestInfo | URL, RequestInit?]) => {
        const body = readBody(init);
        return (
          requestUrl(input).endsWith('/tutor') &&
          body.message === 'Can you explain your last answer in simpler terms?'
        );
      },
    );
    expect(quickActionCall).toBeDefined();

    // Clearing the conversation empties the chat back to the example-question state.
    await user.click(screen.getByRole('button', { name: 'Clear chat' }));
    await screen.findByRole('button', { name: 'What is the main idea of this material?' });
  });
});
