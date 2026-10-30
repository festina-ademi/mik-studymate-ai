import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useExplainerPlayer } from './useExplainerPlayer';
import type { ApiLanguage } from '../lib/api';
import type { SpeakTextOptions, TtsController } from '../lib/tts';

const METADATA = {
  document_id: 'doc-1',
  level: 'beginner',
  language: 'en',
  simplified: false,
  prompt_version: '9',
  model: 'mock',
  cached: false,
};

const PLAN_RESPONSE = {
  document_id: 'doc-1',
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
      title: 'Going further',
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
    text: "Welcome. Let's begin.",
    captions: ['Welcome.', "Let's begin."],
    source_reference: null,
    page_start: null,
    page_end: null,
    line_start: null,
    line_end: null,
    quiz: null,
    metadata: METADATA,
  },
};

function sectionResponse(index: number, title: string) {
  return {
    section_index: index,
    title,
    text: `${title}. More about ${title}.`,
    captions: [`${title}.`, `More about ${title}.`],
    source_reference: `Page ${String(index + 1)}`,
    page_start: index + 1,
    page_end: index + 1,
    line_start: null,
    line_end: null,
    quiz: null,
    metadata: METADATA,
  };
}

const SECTION_RESPONSES: Record<number, unknown> = {
  0: sectionResponse(0, 'Getting started'),
  1: sectionResponse(1, 'Going further'),
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function stubExplainerFetch(): void {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes('/explainer/plan')) {
      return Promise.resolve(Response.json(PLAN_RESPONSE));
    }
    const sectionMatch = /\/explainer\/sections\/(-?\d+)/.exec(url);
    if (sectionMatch) {
      const index = Number(sectionMatch[1]);
      const body = SECTION_RESPONSES[index];
      if (body) {
        return Promise.resolve(Response.json(body));
      }
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

interface SpeakCall {
  text: string;
  language: ApiLanguage;
  rate: number | undefined;
  options: SpeakTextOptions;
}

let speakCalls: SpeakCall[] = [];
let prefetchCalls: string[] = [];
let pauseCallCount = 0;
let playCallCount = 0;
let setPlaybackRateCalls: number[] = [];
/** When true, `setPlaybackRate` reports success (as the real server engine would). */
let liveRateChangeSupported = true;

vi.mock('../lib/tts', () => ({
  getTtsHealth: vi.fn(() =>
    Promise.resolve({ available: true, modelsLoaded: { sq: true, en: true } }),
  ),
  prefetchSpeech: vi.fn((text: string) => {
    prefetchCalls.push(text);
  }),
  speakText: vi.fn(
    (text: string, language: ApiLanguage, options: SpeakTextOptions = {}): TtsController => {
      speakCalls.push({ text, language, rate: options.rate, options });
      options.onEngineResolved?.('server');
      return {
        engine: 'server',
        play: () => {
          playCallCount += 1;
        },
        pause: () => {
          pauseCallCount += 1;
        },
        stop: () => undefined,
        setPlaybackRate: (rate: number) => {
          setPlaybackRateCalls.push(rate);
          return liveRateChangeSupported;
        },
      };
    },
  ),
}));

/** Simulate the utterance most recently passed to `speakText` finishing playback normally. */
function finishLastUtterance(): void {
  const call = speakCalls.at(-1);
  call?.options.onEnd?.();
}

describe('useExplainerPlayer', () => {
  beforeEach(() => {
    speakCalls = [];
    prefetchCalls = [];
    pauseCallCount = 0;
    playCallCount = 0;
    setPlaybackRateCalls = [];
    liveRateChangeSupported = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the overview and plays it, speaking its captions one utterance at a time', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });
    expect(result.current.isOverview).toBe(true);
    expect(result.current.currentScript?.text).toBe("Welcome. Let's begin.");

    act(() => {
      result.current.play();
    });

    expect(result.current.status).toBe('playing');
    expect(speakCalls).toHaveLength(1);
    expect(speakCalls[0]?.text).toBe('Welcome.');

    act(() => {
      finishLastUtterance();
    });

    expect(speakCalls).toHaveLength(2);
    expect(speakCalls[1]?.text).toBe("Let's begin.");
  });

  it('pauses playback through the current controller', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.play();
    });
    expect(result.current.status).toBe('playing');

    act(() => {
      result.current.pause();
    });

    expect(result.current.status).toBe('paused');
    expect(pauseCallCount).toBe(1);
  });

  it('advances to the next section, fetching and auto-playing its script', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.next();
    });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(0);
    });
    expect(result.current.currentScript?.title).toBe('Getting started');
    expect(result.current.isOverview).toBe(false);
    // Section scripts autoplay once loaded.
    expect(result.current.status).toBe('playing');
    expect(speakCalls.at(-1)?.text).toBe('Getting started.');
  });

  it('goToSection() jumps directly to an arbitrary section and autoplays it', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.goToSection(1);
    });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(1);
    });
    expect(result.current.currentScript?.title).toBe('Going further');
    expect(result.current.status).toBe('playing');
    expect(speakCalls.at(-1)?.text).toBe('Going further.');
  });

  it('goToSection() is a no-op for the already-current section or an out-of-range index', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.goToSection(-1); // already the overview, the current section
    });
    expect(result.current.isOverview).toBe(true);
    expect(speakCalls).toHaveLength(0);

    act(() => {
      result.current.goToSection(99);
    });
    expect(result.current.isOverview).toBe(true);
    expect(speakCalls).toHaveLength(0);
  });

  it('ask() pauses playback and opens the tutor; resumeFromAsk() resumes it', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.play();
    });
    expect(result.current.status).toBe('playing');

    act(() => {
      result.current.ask();
    });

    expect(result.current.isAsking).toBe(true);
    expect(result.current.status).toBe('paused');
    expect(pauseCallCount).toBe(1);

    act(() => {
      result.current.resumeFromAsk();
    });

    expect(result.current.isAsking).toBe(false);
    expect(result.current.status).toBe('playing');
    expect(playCallCount).toBe(1);
  });

  it('does not resume playback after asking when it was already paused beforehand', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.play();
    });
    act(() => {
      result.current.pause();
    });
    expect(result.current.status).toBe('paused');

    act(() => {
      result.current.ask();
    });
    act(() => {
      result.current.resumeFromAsk();
    });

    // Playback was already paused (by the learner) before asking, so resuming from "ask" must
    // not restart it behind their back.
    expect(result.current.status).toBe('paused');
    expect(playCallCount).toBe(0);
  });

  it('play() restarts the section from the beginning even when paused (Phase 5b)', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.play();
    });
    act(() => {
      finishLastUtterance(); // advances to the second caption
    });
    expect(speakCalls).toHaveLength(2);

    act(() => {
      result.current.pause();
    });
    expect(pauseCallCount).toBe(1);

    act(() => {
      result.current.play();
    });

    // A fresh utterance from caption 0 ("Welcome."), not an in-place resume of the second one.
    expect(playCallCount).toBe(0);
    expect(speakCalls).toHaveLength(3);
    expect(speakCalls[2]?.text).toBe('Welcome.');
  });

  it('dismissAsk() ends the ask without resuming, even if playback was paused by it', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.play();
    });
    act(() => {
      result.current.ask();
    });
    expect(result.current.isAsking).toBe(true);
    expect(result.current.status).toBe('paused');

    act(() => {
      result.current.dismissAsk();
    });

    expect(result.current.isAsking).toBe(false);
    expect(result.current.status).toBe('paused'); // unlike resumeFromAsk, nothing resumed
    expect(playCallCount).toBe(0);
  });

  it('setSpeed() changes the controller playback rate in place without re-fetching', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.play();
    });
    expect(speakCalls).toHaveLength(1);

    act(() => {
      result.current.setSpeed(1.5);
    });

    expect(setPlaybackRateCalls).toEqual([1.5]);
    // The live rate change succeeded, so no new utterance was started.
    expect(speakCalls).toHaveLength(1);
    expect(result.current.speed).toBe(1.5);
  });

  it('setSpeed() restarts the utterance when the active engine cannot change rate live', async () => {
    liveRateChangeSupported = false;
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.play();
    });
    expect(speakCalls).toHaveLength(1);

    act(() => {
      result.current.setSpeed(1.5);
    });

    // No live rate control (e.g. the browser engine): falls back to restarting the utterance.
    expect(speakCalls).toHaveLength(2);
    expect(speakCalls[1]?.rate).toBe(1.5);
  });

  it('reports the engine that actually spoke, via onEngineResolved', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    expect(result.current.voiceEngine).toBeNull();

    act(() => {
      result.current.play();
    });

    expect(result.current.voiceEngine).toBe('server');
  });

  it('prefetches the next caption while the current one is still playing', async () => {
    stubExplainerFetch();
    const { result } = renderHook(() =>
      useExplainerPlayer({ documentId: 'doc-1', level: 'beginner', language: 'en' }),
    );
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.play();
    });

    // Caption 1 is still playing (no onEnd yet), and caption 2 is already being synthesized.
    expect(speakCalls.map((call) => call.text)).toEqual(['Welcome.']);
    expect(prefetchCalls).toEqual(["Let's begin."]);

    act(() => {
      finishLastUtterance();
    });

    expect(speakCalls.map((call) => call.text)).toEqual(['Welcome.', "Let's begin."]);
    // Nothing after the last caption to prefetch.
    expect(prefetchCalls).toEqual(["Let's begin."]);
  });
});
