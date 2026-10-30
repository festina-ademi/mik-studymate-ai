import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderApp, sseJsonResponse } from '../test/utils';
import { STORAGE_KEYS, writeJsonStorage, writeStorage } from '../lib/storage';
import type { DocumentRecord } from '../lib/api';
import type { SpeakTextOptions, TtsController } from '../lib/tts';

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

// Narration is simulated: an utterance "plays" until the test ends it, and the controller
// records pause/play so the test can tell a resume-in-place from a restart.
let spokenTexts: string[] = [];
let pauseCount = 0;
let resumeCount = 0;

vi.mock('../lib/tts', () => ({
  getTtsHealth: () => Promise.resolve({ available: true, modelsLoaded: { sq: true, en: true } }),
  prefetchSpeech: () => undefined,
  speakText: (text: string, _language: string, options: SpeakTextOptions = {}): TtsController => {
    spokenTexts.push(text);
    options.onEngineResolved?.('server');
    return {
      engine: 'server',
      play: () => {
        resumeCount += 1;
      },
      pause: () => {
        pauseCount += 1;
      },
      stop: () => undefined,
      setPlaybackRate: () => true,
    };
  },
}));

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

function sseResponse(events: { event: string; data: unknown }[]): Response {
  const text = events
    .map((entry) => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`)
    .join('');
  return new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function tutorTurn(answer: string): Response {
  return sseResponse([
    { event: 'token', data: { text: answer } },
    {
      event: 'result',
      data: {
        answer,
        citations: [],
        follow_up_questions: [],
        conversation_id: 'conv-1',
        metadata: METADATA,
      },
    },
    { event: 'done', data: {} },
  ]);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(): void {
  let turn = 0;
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
          metadata: { ...METADATA, content_type: 'lecture', task: 'summary', chunks_used: 1 },
        }),
      );
    }
    if (url.includes('/explainer/plan')) {
      return Promise.resolve(Response.json(PLAN_RESPONSE));
    }
    if (url.endsWith('/tutor/history') && method === 'GET') {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/tutor') && method === 'POST') {
      turn += 1;
      return Promise.resolve(tutorTurn(`Answer number ${String(turn)}.`));
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

const BACK = 'Back to the Teacher';

async function startNarration(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Avatar' }));
  await user.click(await screen.findByRole('button', { name: 'Play' }));
  await waitFor(() => {
    expect(spokenTexts).toEqual(['Welcome to this document.']);
  });
}

async function sendChatMessage(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
  answer: string,
): Promise<void> {
  await user.type(screen.getByRole('textbox', { name: /Ask about a concept/ }), `${text}{Enter}`);
  await screen.findByText(answer);
}

describe('Avatar "Ask" opens the Chat tab', () => {
  beforeEach(() => {
    spokenTexts = [];
    pauseCount = 0;
    resumeCount = 0;
    Element.prototype.scrollIntoView = vi.fn();
    seedDocument();
    stubFetch();
  });

  it('pauses narration, switches to Chat and focuses the input', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await startNarration(user);

    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(pauseCount).toBe(1);
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true');
    const input = await screen.findByRole('textbox', { name: /Ask about a concept/ });
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    expect(input).toHaveAttribute('id', 'chat-input');
    // The bubble is gone: the full Chat tab is the only chat.
    expect(screen.queryByText('Quick question')).not.toBeInTheDocument();
  });

  it('shows "Back to the Teacher", which returns to the Avatar and resumes in place', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await startNarration(user);
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await sendChatMessage(user, 'What is this about?', 'Answer number 1.');
    await user.click(screen.getByRole('button', { name: BACK }));

    expect(screen.getByRole('button', { name: 'Avatar' })).toHaveAttribute('aria-pressed', 'true');
    // Resumed the paused utterance (controller.play), not restarted the section.
    expect(resumeCount).toBe(1);
    expect(spokenTexts).toEqual(['Welcome to this document.']);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('does not resume on return when narration was not playing at "Ask"', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(await screen.findByRole('button', { name: 'Avatar' }));
    await screen.findByRole('button', { name: 'Play' });

    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await user.click(await screen.findByRole('button', { name: BACK }));

    expect(resumeCount).toBe(0);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('dismisses the banner after three messages are sent in Chat', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await startNarration(user);
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await sendChatMessage(user, 'First question', 'Answer number 1.');
    await sendChatMessage(user, 'Second question', 'Answer number 2.');
    expect(screen.getByRole('button', { name: BACK })).toBeInTheDocument();
    await sendChatMessage(user, 'Third question', 'Answer number 3.');

    expect(screen.queryByRole('button', { name: BACK })).not.toBeInTheDocument();
  });

  it('shows no banner when Chat is opened directly, or after leaving Chat another way', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Chat' }));
    await screen.findByRole('textbox', { name: /Ask about a concept/ });
    expect(screen.queryByRole('button', { name: BACK })).not.toBeInTheDocument();

    await startNarration(user);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByRole('button', { name: BACK })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Summary' }));
    await user.click(screen.getByRole('button', { name: 'Chat' }));

    await screen.findByRole('textbox', { name: /Ask about a concept/ });
    expect(screen.queryByRole('button', { name: BACK })).not.toBeInTheDocument();
  });
});
