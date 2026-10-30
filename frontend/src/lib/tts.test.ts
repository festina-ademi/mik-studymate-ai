import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getTtsHealth,
  prefetchSpeech,
  resetPrefetchedSpeech,
  resetTtsHealthCache,
  speakText,
} from './tts';

const { synthesizeSpeechMock, apiGetTtsHealthMock } = vi.hoisted(() => ({
  synthesizeSpeechMock: vi.fn(),
  apiGetTtsHealthMock: vi.fn(),
}));

vi.mock('./api', () => ({
  synthesizeSpeech: synthesizeSpeechMock,
  getTtsHealth: apiGetTtsHealthMock,
}));

let instances: FakeAudio[] = [];

class FakeAudio {
  src: string;
  playbackRate = 1;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    instances.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('speakText', () => {
  beforeEach(() => {
    instances = [];
    synthesizeSpeechMock.mockReset();
    apiGetTtsHealthMock.mockReset();
    resetTtsHealthCache();
    resetPrefetchedSpeech();
    vi.stubGlobal('Audio', FakeAudio);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-audio');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(window.speechSynthesis, 'getVoices').mockReturnValue([
      { lang: 'en-US', name: 'Test Voice', voiceURI: 'test', default: true, localService: true },
    ]);
  });

  it('synthesizes and plays the server audio when it succeeds', async () => {
    synthesizeSpeechMock.mockResolvedValue(new Blob(['fake wav bytes'], { type: 'audio/wav' }));
    const onEngineResolved = vi.fn();

    speakText('Hello.', 'en', { onEngineResolved });
    await flushMicrotasks();

    expect(synthesizeSpeechMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello.', language: 'en' }),
    );
    expect(onEngineResolved).toHaveBeenCalledWith('server');
    expect(instances).toHaveLength(1);
    expect(instances[0]?.paused).toBe(false); // audio.play() was called
  });

  it('falls back to the browser voice on a network/fetch failure', async () => {
    synthesizeSpeechMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const speakSpy = vi.spyOn(window.speechSynthesis, 'speak');
    const onEngineResolved = vi.fn();

    speakText('Hello.', 'en', { onEngineResolved });
    await flushMicrotasks();

    expect(onEngineResolved).toHaveBeenCalledWith('browser');
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(0); // no server audio element was ever created
  });

  it('falls back to the browser voice when the server synthesis times out', async () => {
    // `synthesizeSpeech` itself enforces the >60s timeout via `AbortSignal.timeout`; from this
    // module's point of view a timeout and a network failure look the same (a rejected promise),
    // so simulating the resulting AbortError is what actually exercises the fallback path here.
    synthesizeSpeechMock.mockRejectedValue(
      new DOMException('The operation timed out.', 'AbortError'),
    );
    const speakSpy = vi.spyOn(window.speechSynthesis, 'speak');
    const onEngineResolved = vi.fn();

    speakText('Hello.', 'en', { onEngineResolved });
    await flushMicrotasks();

    expect(onEngineResolved).toHaveBeenCalledWith('browser');
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  it('changes the server audio playback rate in place, without a new synthesize call', async () => {
    synthesizeSpeechMock.mockResolvedValue(new Blob(['fake wav bytes'], { type: 'audio/wav' }));

    const controller = speakText('Hello.', 'en', { rate: 1 });
    await flushMicrotasks();

    const applied = controller.setPlaybackRate(1.5);

    expect(applied).toBe(true);
    expect(instances[0]?.playbackRate).toBe(1.5);
    expect(synthesizeSpeechMock).toHaveBeenCalledTimes(1);
  });

  it('skips the server attempt entirely when preferBrowser is set', () => {
    const onEngineResolved = vi.fn();

    speakText('Hello.', 'en', { preferBrowser: true, onEngineResolved });

    expect(synthesizeSpeechMock).not.toHaveBeenCalled();
    expect(onEngineResolved).toHaveBeenCalledWith('browser');
  });

  it('speaks the browser utterance without citation markers', () => {
    const speakSpy = vi.spyOn(window.speechSynthesis, 'speak');

    speakText('Then the rules are counted [pasted_code_2026-10-13.py:17].', 'en', {
      preferBrowser: true,
    });

    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy.mock.calls[0]?.[0].text).toBe('Then the rules are counted.');
  });

  it('strips citations from the browser fallback after a server failure too', async () => {
    synthesizeSpeechMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const speakSpy = vi.spyOn(window.speechSynthesis, 'speak');

    speakText('See [Faqja 5] here.', 'en', {});
    await flushMicrotasks();

    expect(synthesizeSpeechMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'See here.' }),
    );
    expect(speakSpy.mock.calls[0]?.[0].text).toBe('See here.');
  });

  it('finishes at once, without speaking, when the text is only a citation', async () => {
    const speakSpy = vi.spyOn(window.speechSynthesis, 'speak');
    const onEnd = vi.fn();

    speakText('  [Page 3] ', 'en', { onEnd });
    await flushMicrotasks();

    expect(synthesizeSpeechMock).not.toHaveBeenCalled();
    expect(speakSpy).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('prefetchSpeech', () => {
  beforeEach(() => {
    instances = [];
    synthesizeSpeechMock.mockReset();
    resetPrefetchedSpeech();
    vi.stubGlobal('Audio', FakeAudio);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-audio');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  it('lets speakText reuse a prefetched synthesis instead of requesting it again', async () => {
    synthesizeSpeechMock.mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }));

    prefetchSpeech('Next caption [Page 2].', 'en');
    speakText('Next caption [Page 2].', 'en');
    await flushMicrotasks();

    expect(synthesizeSpeechMock).toHaveBeenCalledTimes(1);
    expect(synthesizeSpeechMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Next caption.', language: 'en' }),
    );
    expect(instances).toHaveLength(1);
  });

  it('starts the next clip without waiting once its prefetch finished during playback', async () => {
    vi.useFakeTimers();
    try {
      // Synthesis takes 4s (measured: 3.5-5s per caption); the current clip plays for 6s.
      synthesizeSpeechMock.mockImplementation(
        () =>
          new Promise<Blob>((resolve) => {
            setTimeout(() => {
              resolve(new Blob(['wav'], { type: 'audio/wav' }));
            }, 4_000);
          }),
      );
      prefetchSpeech('Second paragraph.', 'en'); // when the first paragraph starts playing
      await vi.advanceTimersByTimeAsync(6_000); // the first paragraph plays to its end

      const endedAt = Date.now();
      speakText('Second paragraph.', 'en');
      await vi.advanceTimersByTimeAsync(0);

      expect(instances).toHaveLength(1);
      expect(instances[0]?.paused).toBe(false); // already playing
      expect(Date.now() - endedAt).toBeLessThan(2_000);
      expect(synthesizeSpeechMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the browser voice when the prefetched synthesis failed', async () => {
    synthesizeSpeechMock.mockRejectedValue(new TypeError('Failed to fetch'));
    vi.spyOn(window.speechSynthesis, 'getVoices').mockReturnValue([
      { lang: 'en-US', name: 'Test Voice', voiceURI: 'test', default: true, localService: true },
    ]);
    const speakSpy = vi.spyOn(window.speechSynthesis, 'speak');

    prefetchSpeech('Hello.', 'en');
    await flushMicrotasks();
    speakText('Hello.', 'en');
    await flushMicrotasks();

    expect(speakSpy).toHaveBeenCalledTimes(1);
  });
});

describe('getTtsHealth', () => {
  beforeEach(() => {
    apiGetTtsHealthMock.mockReset();
    resetTtsHealthCache();
  });

  it('caches the result for the rest of the session', async () => {
    apiGetTtsHealthMock.mockResolvedValue({
      available: true,
      modelsLoaded: { sq: true, en: false },
    });

    const first = await getTtsHealth();
    const second = await getTtsHealth();

    expect(first).toEqual({ available: true, modelsLoaded: { sq: true, en: false } });
    expect(second).toBe(first);
    expect(apiGetTtsHealthMock).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable rather than throwing when the health check itself fails', async () => {
    apiGetTtsHealthMock.mockRejectedValue(new Error('network error'));

    const health = await getTtsHealth();

    expect(health).toEqual({ available: false, modelsLoaded: { sq: false, en: false } });
  });
});
